let JSZip = require('jszip');

type Rectangle = {
    x: number,
    y: number,
    width: number,
    height: number
};

type BoundaryPoint = {
    x: number,
    y: number
};

type PngMetadata = {
    [key: string]: any
};

type GridSize = {
    value: string,
    width: number,
    height: number
};

type FrameDefinition = Rectangle & {
    index: number,
    source: string
};

type ProcessedFrame = {
    crop: Rectangle,
    polygon: BoundaryPoint[],
    sourceFrame: FrameDefinition
};

type DatasetEntry = {
    classId: number,
    className: string,
    split: string,
    imagePath: string,
    labelPath: string,
    sourceFile: string,
    frameIndex: number,
    frameSource: string,
    width: number,
    height: number
};

type GridCandidate = {
    gridSize: GridSize,
    frames: FrameDefinition[],
    totalTileCount: number
};

class YoloSegAnnotationGenerator {
    private static readonly PNG_TEXT_METADATA_KEYWORD = 'OpenTibiaLibrary';
    private static readonly SUPPORTED_GRID_SIZES: GridSize[] = [
        {value: '32x32', width: 32, height: 32},
        {value: '64x64', width: 64, height: 64},
        {value: '128x64', width: 128, height: 64},
        {value: '128x128', width: 128, height: 128}
    ];
    private static readonly GENERIC_FOLDER_NAMES = {
        images: true,
        image: true,
        labels: true,
        label: true,
        items: true,
        outfits: true,
        effects: true,
        missiles: true,
        sprites: true,
        train: true,
        val: true,
        test: true
    };

    private sourceFolderPicker: HTMLInputElement;
    private datasetNameInput: HTMLInputElement;
    private alphaThresholdInput: HTMLInputElement;
    private validationSplitInput: HTMLInputElement;
    private gridSizeSelect: HTMLSelectElement;
    private cropTransparentMarginsCheckbox: HTMLInputElement;
    private generateButton: HTMLButtonElement;
    private progressBar: HTMLElement;

    private classIdsByName: {[className: string]: number} = {};
    private classNames: string[] = [];
    private sampleCountsByClassName: {[className: string]: number} = {};
    private manifestEntries: DatasetEntry[] = [];

    init() {
        this.sourceFolderPicker = <HTMLInputElement>document.getElementById('sourceFolder');
        this.datasetNameInput = <HTMLInputElement>document.getElementById('datasetName');
        this.alphaThresholdInput = <HTMLInputElement>document.getElementById('alphaThreshold');
        this.validationSplitInput = <HTMLInputElement>document.getElementById('validationSplit');
        this.gridSizeSelect = <HTMLSelectElement>document.getElementById('gridSize');
        this.cropTransparentMarginsCheckbox = <HTMLInputElement>document.getElementById('cropTransparentMargins');
        this.generateButton = <HTMLButtonElement>document.getElementById('generateDataset');
        this.progressBar = document.getElementById('progressBar');

        const self = this;
        this.generateButton.onclick = function () {
            self.generateDataset();
        };
    }

    private async generateDataset() {
        if (!this.sourceFolderPicker.files || this.sourceFolderPicker.files.length === 0) {
            this.progressText('ERROR: Please select a folder with PNG files.');
            return;
        }

        const pngFiles = Array.from(this.sourceFolderPicker.files)
            .filter(file => file.name.toLowerCase().endsWith('.png'))
            .sort((left, right) => this.getFilePath(left).localeCompare(this.getFilePath(right)));

        if (pngFiles.length === 0) {
            this.progressText('ERROR: No PNG files were found in the selected folder.');
            return;
        }

        const datasetName = this.sanitizeName(this.datasetNameInput.value) || 'outfit_yolo_seg';
        const alphaThreshold = Math.max(0, Math.min(254, parseInt(this.alphaThresholdInput.value, 10) || 1));
        const validationSplitPercent = Math.max(0, Math.min(50, parseInt(this.validationSplitInput.value, 10) || 20));

        this.classIdsByName = {};
        this.classNames = [];
        this.sampleCountsByClassName = {};
        this.manifestEntries = [];

        const zip = new JSZip();
        for (let fileIndex = 0; fileIndex < pngFiles.length; fileIndex++) {
            const file = pngFiles[fileIndex];
            this.progressText('Processing PNG files (' + (fileIndex + 1) + '/' + pngFiles.length + '): ' + file.name);
            await this.processPngFile(zip, file, alphaThreshold, validationSplitPercent);
        }

        zip.file('classes.txt', this.classNames.join('\n'));
        zip.file('dataset.yaml', this.generateDatasetYaml(datasetName));
        zip.file('manifest.json', JSON.stringify({
            dataset_name: datasetName,
            classes: this.classNames,
            samples: this.manifestEntries
        }, null, 2));
        zip.file('README.txt', this.generateReadme(datasetName, pngFiles.length, validationSplitPercent));

        this.progressText('Packing dataset ZIP file, please wait');
        const blob = await zip.generateAsync({type: 'blob'});
        this.progressText('Dataset generated, it should start download now.');
        this.downloadBlob(datasetName + '.zip', blob);
    }

    private async processPngFile(zip, file: File, alphaThreshold: number, validationSplitPercent: number) {
        const arrayBuffer = await this.readFileAsArrayBuffer(file);
        const metadata = this.readPngMetadata(arrayBuffer);
        const imageInfo = await this.loadImageData(file);
        const className = this.resolveClassName(file, metadata);
        const classId = this.getClassId(className);
        const frames = this.detectFrames(imageInfo.imageData, metadata, alphaThreshold);

        for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
            const processedFrame = this.prepareFrame(imageInfo.imageData, frames[frameIndex], alphaThreshold);
            if (!processedFrame) {
                continue;
            }

            const sampleIndex = this.getNextSampleIndex(className);
            const sampleBaseName = className + '_' + this.padNumber(sampleIndex, 6);
            const splitName = this.resolveDatasetSplit(sampleIndex, validationSplitPercent);
            const imageRelativePath = 'images/' + splitName + '/' + className + '/' + sampleBaseName + '.png';
            const labelRelativePath = 'labels/' + splitName + '/' + className + '/' + sampleBaseName + '.txt';

            const croppedImageBlob = await this.exportFrameCrop(imageInfo.imageData, processedFrame.crop);
            zip.file(imageRelativePath, croppedImageBlob);
            zip.file(labelRelativePath, this.generateYoloSegLine(classId, processedFrame.polygon, processedFrame.crop.width, processedFrame.crop.height) + '\n');

            this.manifestEntries.push({
                classId,
                className,
                split: splitName,
                imagePath: imageRelativePath,
                labelPath: labelRelativePath,
                sourceFile: this.getFilePath(file),
                frameIndex: processedFrame.sourceFrame.index,
                frameSource: processedFrame.sourceFrame.source,
                width: processedFrame.crop.width,
                height: processedFrame.crop.height
            });
        }
    }

    private resolveDatasetSplit(sampleIndex: number, validationSplitPercent: number): string {
        if (validationSplitPercent <= 0) {
            return 'train';
        }

        const splitModulo = 100 / validationSplitPercent;
        if (Number.isInteger(splitModulo) && sampleIndex % splitModulo === 0) {
            return 'val';
        }

        const validationThreshold = validationSplitPercent / 100;
        const normalizedPosition = ((sampleIndex - 1) % 100) / 100;
        return normalizedPosition < validationThreshold ? 'val' : 'train';
    }

    private detectFrames(imageData: ImageData, metadata: PngMetadata, alphaThreshold: number): FrameDefinition[] {
        const metadataFrames = this.detectFramesFromMetadata(imageData, metadata, alphaThreshold);
        if (metadataFrames.length > 0) {
            return metadataFrames;
        }

        const gridFrames = this.detectFramesFromConfiguredGrid(imageData, alphaThreshold);
        if (gridFrames.length > 0) {
            return gridFrames;
        }

        return [{
            x: 0,
            y: 0,
            width: imageData.width,
            height: imageData.height,
            index: 1,
            source: 'full_image'
        }];
    }

    private detectFramesFromMetadata(imageData: ImageData, metadata: PngMetadata, alphaThreshold: number): FrameDefinition[] {
        const metadataFrameCount = this.getMetadataFrameCount(metadata);
        if (metadataFrameCount <= 1) {
            return [];
        }

        if (imageData.width % metadataFrameCount === 0 &&
            this.isSupportedGridSize(imageData.width / metadataFrameCount, imageData.height)) {
            const frameWidth = imageData.width / metadataFrameCount;
            const frames: FrameDefinition[] = [];
            for (let frameIndex = 0; frameIndex < metadataFrameCount; frameIndex++) {
                frames.push({
                    x: frameIndex * frameWidth,
                    y: 0,
                    width: frameWidth,
                    height: imageData.height,
                    index: frameIndex + 1,
                    source: 'metadata_horizontal_strip'
                });
            }
            return frames;
        }

        if (imageData.height % metadataFrameCount === 0 &&
            this.isSupportedGridSize(imageData.width, imageData.height / metadataFrameCount)) {
            const frameHeight = imageData.height / metadataFrameCount;
            const frames: FrameDefinition[] = [];
            for (let frameIndex = 0; frameIndex < metadataFrameCount; frameIndex++) {
                frames.push({
                    x: 0,
                    y: frameIndex * frameHeight,
                    width: imageData.width,
                    height: frameHeight,
                    index: frameIndex + 1,
                    source: 'metadata_vertical_strip'
                });
            }
            return frames;
        }

        const candidateGrids = this.getGridCandidates(imageData, alphaThreshold, true)
            .filter(candidate => candidate.frames.length === metadataFrameCount);
        if (candidateGrids.length > 0) {
            return this.pickBestGridCandidate(candidateGrids).frames;
        }

        return [];
    }

    private detectFramesFromConfiguredGrid(imageData: ImageData, alphaThreshold: number): FrameDefinition[] {
        const selectedGridValue = this.gridSizeSelect ? this.gridSizeSelect.value : 'auto';
        if (selectedGridValue !== 'auto') {
            const selectedGridSize = this.getSupportedGridSizeByValue(selectedGridValue);
            if (!selectedGridSize) {
                return [];
            }

            return this.buildFramesFromGrid(imageData, selectedGridSize, alphaThreshold);
        }

        const heightDrivenGrid = this.getAutoHeightDrivenGrid(imageData);
        if (heightDrivenGrid) {
            const heightDrivenFrames = this.buildFramesFromGrid(imageData, heightDrivenGrid, alphaThreshold);
            if (heightDrivenFrames.length > 0) {
                return heightDrivenFrames;
            }
        }

        const candidateGrids = this.getGridCandidates(imageData, alphaThreshold, false);
        if (candidateGrids.length === 0) {
            return [];
        }

        const exactImageGrid = this.findExactImageGridCandidate(imageData, candidateGrids);
        if (exactImageGrid) {
            return exactImageGrid.frames;
        }

        return this.pickBestGridCandidate(candidateGrids).frames;
    }

    private getAutoHeightDrivenGrid(imageData: ImageData): GridSize | null {
        const squareGridValue = imageData.height + 'x' + imageData.height;
        const squareGrid = this.getSupportedGridSizeByValue(squareGridValue);
        if (squareGrid && imageData.width % squareGrid.width === 0) {
            return squareGrid;
        }

        return null;
    }

    private getGridCandidates(imageData: ImageData, alphaThreshold: number, includeSingleFrameCandidates: boolean): GridCandidate[] {
        const candidates: GridCandidate[] = [];
        for (const gridSize of YoloSegAnnotationGenerator.SUPPORTED_GRID_SIZES) {
            const frames = this.buildFramesFromGrid(imageData, gridSize, alphaThreshold);
            if (frames.length === 0) {
                continue;
            }
            if (!includeSingleFrameCandidates && frames.length === 1) {
                continue;
            }

            candidates.push({
                gridSize,
                frames,
                totalTileCount: (imageData.width / gridSize.width) * (imageData.height / gridSize.height)
            });
        }

        return candidates;
    }

    private buildFramesFromGrid(imageData: ImageData, gridSize: GridSize, alphaThreshold: number): FrameDefinition[] {
        if (imageData.width % gridSize.width !== 0 || imageData.height % gridSize.height !== 0) {
            return [];
        }

        const frames: FrameDefinition[] = [];
        let frameIndex = 1;
        const columns = imageData.width / gridSize.width;
        const rows = imageData.height / gridSize.height;
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const frameRect = {
                    x: column * gridSize.width,
                    y: row * gridSize.height,
                    width: gridSize.width,
                    height: gridSize.height
                };
                if (!this.hasOpaquePixels(imageData, frameRect, alphaThreshold)) {
                    continue;
                }

                frames.push({
                    x: frameRect.x,
                    y: frameRect.y,
                    width: frameRect.width,
                    height: frameRect.height,
                    index: frameIndex,
                    source: 'fixed_grid_' + gridSize.value
                });
                frameIndex++;
            }
        }

        return frames;
    }

    private findExactImageGridCandidate(imageData: ImageData, candidates: GridCandidate[]): GridCandidate | null {
        for (const candidate of candidates) {
            if (candidate.gridSize.width === imageData.width && candidate.gridSize.height === imageData.height) {
                return candidate;
            }
        }

        return null;
    }

    private pickBestGridCandidate(candidates: GridCandidate[]): GridCandidate {
        const sortedCandidates = candidates.slice().sort((left, right) => {
            if (left.frames.length !== right.frames.length) {
                return right.frames.length - left.frames.length;
            }

            const leftArea = left.gridSize.width * left.gridSize.height;
            const rightArea = right.gridSize.width * right.gridSize.height;
            if (leftArea !== rightArea) {
                return rightArea - leftArea;
            }

            return right.totalTileCount - left.totalTileCount;
        });

        return sortedCandidates[0];
    }

    private getSupportedGridSizeByValue(value: string): GridSize | null {
        for (const gridSize of YoloSegAnnotationGenerator.SUPPORTED_GRID_SIZES) {
            if (gridSize.value === value) {
                return gridSize;
            }
        }

        return null;
    }

    private isSupportedGridSize(width: number, height: number): boolean {
        return this.getSupportedGridSizeByValue(width + 'x' + height) !== null;
    }

    private prepareFrame(imageData: ImageData, frameRect: FrameDefinition, alphaThreshold: number): ProcessedFrame | null {
        const cropBounds = this.cropTransparentMarginsCheckbox.checked
            ? this.getOpaqueBounds(imageData, frameRect, alphaThreshold)
            : frameRect;

        if (!cropBounds || cropBounds.width <= 0 || cropBounds.height <= 0) {
            return null;
        }

        const polygon = this.extractPrimaryPolygon(imageData, cropBounds, alphaThreshold);
        if (!polygon || polygon.length < 3) {
            return null;
        }

        return {
            crop: cropBounds,
            polygon,
            sourceFrame: frameRect
        };
    }

    private getOpaqueBounds(imageData: ImageData, frameRect: Rectangle, alphaThreshold: number): Rectangle | null {
        let minX = frameRect.x + frameRect.width;
        let minY = frameRect.y + frameRect.height;
        let maxX = frameRect.x - 1;
        let maxY = frameRect.y - 1;

        for (let y = frameRect.y; y < frameRect.y + frameRect.height; y++) {
            for (let x = frameRect.x; x < frameRect.x + frameRect.width; x++) {
                if (this.getAlphaAt(imageData, x, y) <= alphaThreshold) {
                    continue;
                }

                if (x < minX) {
                    minX = x;
                }
                if (y < minY) {
                    minY = y;
                }
                if (x > maxX) {
                    maxX = x;
                }
                if (y > maxY) {
                    maxY = y;
                }
            }
        }

        if (maxX < minX || maxY < minY) {
            return null;
        }

        const padding = 1;
        const paddedMinX = Math.max(frameRect.x, minX - padding);
        const paddedMinY = Math.max(frameRect.y, minY - padding);
        const paddedMaxX = Math.min(frameRect.x + frameRect.width - 1, maxX + padding);
        const paddedMaxY = Math.min(frameRect.y + frameRect.height - 1, maxY + padding);

        return {
            x: paddedMinX,
            y: paddedMinY,
            width: paddedMaxX - paddedMinX + 1,
            height: paddedMaxY - paddedMinY + 1
        };
    }

    private extractPrimaryPolygon(imageData: ImageData, cropRect: Rectangle, alphaThreshold: number): BoundaryPoint[] | null {
        const mask = new Array(cropRect.width * cropRect.height).fill(false);
        for (let localY = 0; localY < cropRect.height; localY++) {
            for (let localX = 0; localX < cropRect.width; localX++) {
                mask[localY * cropRect.width + localX] =
                    this.getAlphaAt(imageData, cropRect.x + localX, cropRect.y + localY) > alphaThreshold;
            }
        }

        const polygons = this.extractMaskPolygons(mask, cropRect.width, cropRect.height);
        if (polygons.length === 0) {
            return null;
        }

        polygons.sort((left, right) => Math.abs(this.calculatePolygonArea(right)) - Math.abs(this.calculatePolygonArea(left)));
        const simplifiedPolygon = this.simplifyOrthogonalPolygon(polygons[0]);
        return simplifiedPolygon.length >= 3 ? simplifiedPolygon : polygons[0];
    }

    private extractMaskPolygons(mask: boolean[], width: number, height: number): BoundaryPoint[][] {
        const edges: Array<{start: BoundaryPoint, end: BoundaryPoint}> = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!mask[y * width + x]) {
                    continue;
                }

                if (y === 0 || !mask[(y - 1) * width + x]) {
                    edges.push({start: {x, y}, end: {x: x + 1, y}});
                }
                if (x === width - 1 || !mask[y * width + x + 1]) {
                    edges.push({start: {x: x + 1, y}, end: {x: x + 1, y: y + 1}});
                }
                if (y === height - 1 || !mask[(y + 1) * width + x]) {
                    edges.push({start: {x: x + 1, y: y + 1}, end: {x, y: y + 1}});
                }
                if (x === 0 || !mask[y * width + x - 1]) {
                    edges.push({start: {x, y: y + 1}, end: {x, y}});
                }
            }
        }

        const edgeMap: {[key: string]: BoundaryPoint[]} = {};
        for (const edge of edges) {
            const key = this.getPointKey(edge.start);
            if (!edgeMap[key]) {
                edgeMap[key] = [];
            }
            edgeMap[key].push(edge.end);
        }

        const usedEdges: {[key: string]: boolean} = {};
        const polygons: BoundaryPoint[][] = [];
        for (const edge of edges) {
            const edgeKey = this.getEdgeKey(edge.start, edge.end);
            if (usedEdges[edgeKey]) {
                continue;
            }

            const polygon: BoundaryPoint[] = [];
            let currentStart = edge.start;
            let currentEnd = edge.end;
            polygon.push({x: currentStart.x, y: currentStart.y});

            while (true) {
                const currentEdgeKey = this.getEdgeKey(currentStart, currentEnd);
                if (usedEdges[currentEdgeKey]) {
                    break;
                }
                usedEdges[currentEdgeKey] = true;
                polygon.push({x: currentEnd.x, y: currentEnd.y});

                if (currentEnd.x === polygon[0].x && currentEnd.y === polygon[0].y) {
                    polygon.pop();
                    break;
                }

                const nextCandidates = edgeMap[this.getPointKey(currentEnd)] || [];
                let nextPoint: BoundaryPoint = null;
                for (const candidate of nextCandidates) {
                    const candidateEdgeKey = this.getEdgeKey(currentEnd, candidate);
                    if (!usedEdges[candidateEdgeKey]) {
                        nextPoint = candidate;
                        break;
                    }
                }

                if (!nextPoint) {
                    break;
                }

                currentStart = currentEnd;
                currentEnd = nextPoint;
            }

            if (polygon.length >= 3) {
                polygons.push(polygon);
            }
        }

        return polygons;
    }

    private simplifyOrthogonalPolygon(points: BoundaryPoint[]): BoundaryPoint[] {
        if (points.length <= 3) {
            return points.slice();
        }

        const simplifiedPoints: BoundaryPoint[] = [];
        for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
            const previousPoint = points[(pointIndex + points.length - 1) % points.length];
            const currentPoint = points[pointIndex];
            const nextPoint = points[(pointIndex + 1) % points.length];

            const isCollinear =
                (previousPoint.x === currentPoint.x && currentPoint.x === nextPoint.x) ||
                (previousPoint.y === currentPoint.y && currentPoint.y === nextPoint.y);

            if (!isCollinear) {
                simplifiedPoints.push(currentPoint);
            }
        }

        return simplifiedPoints.length >= 3 ? simplifiedPoints : points.slice();
    }

    private generateYoloSegLine(classId: number, polygon: BoundaryPoint[], width: number, height: number): string {
        const coordinateValues: string[] = [];
        for (const point of polygon) {
            coordinateValues.push(this.normalizeCoordinate(point.x, width));
            coordinateValues.push(this.normalizeCoordinate(point.y, height));
        }

        return classId + ' ' + coordinateValues.join(' ');
    }

    private normalizeCoordinate(value: number, size: number): string {
        if (size <= 0) {
            return '0';
        }

        const normalizedValue = Math.max(0, Math.min(1, value / size));
        return normalizedValue.toFixed(6);
    }

    private hasOpaquePixels(imageData: ImageData, rect: Rectangle, alphaThreshold: number): boolean {
        for (let y = rect.y; y < rect.y + rect.height; y++) {
            for (let x = rect.x; x < rect.x + rect.width; x++) {
                if (this.getAlphaAt(imageData, x, y) > alphaThreshold) {
                    return true;
                }
            }
        }

        return false;
    }

    private getAlphaAt(imageData: ImageData, x: number, y: number): number {
        return imageData.data[(y * imageData.width + x) * 4 + 3];
    }

    private calculatePolygonArea(points: BoundaryPoint[]): number {
        let area = 0;
        for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
            const currentPoint = points[pointIndex];
            const nextPoint = points[(pointIndex + 1) % points.length];
            area += currentPoint.x * nextPoint.y - nextPoint.x * currentPoint.y;
        }

        return area / 2;
    }

    private getPointKey(point: BoundaryPoint): string {
        return point.x + ',' + point.y;
    }

    private getEdgeKey(start: BoundaryPoint, end: BoundaryPoint): string {
        return this.getPointKey(start) + '>' + this.getPointKey(end);
    }

    private getMetadataFrameCount(metadata: PngMetadata): number {
        const candidates = ['sprites_count', 'frames_count'];
        for (const key of candidates) {
            const value = parseInt(metadata[key], 10);
            if (!isNaN(value) && value > 1) {
                return value;
            }
        }

        return 1;
    }

    private resolveClassName(file: File, metadata: PngMetadata): string {
        const metadataName = this.pickFirstNonEmptyString([
            metadata.outfit_name,
            metadata.item_name,
            metadata.monster_name,
            metadata.name
        ]);
        if (metadataName) {
            return this.sanitizeName(metadataName);
        }

        const pathParts = this.getFilePath(file).split('/').filter(Boolean);
        if (pathParts.length > 1) {
            const parentFolderName = this.sanitizeName(pathParts[pathParts.length - 2]);
            if (parentFolderName && !YoloSegAnnotationGenerator.GENERIC_FOLDER_NAMES[parentFolderName]) {
                return parentFolderName;
            }
        }

        let fileBaseName = file.name.replace(/\.png$/i, '');
        if (metadata.direction) {
            fileBaseName = fileBaseName.replace(/_\d+$/, '');
        }
        if (metadata.sprites_count || metadata.frames_count) {
            fileBaseName = fileBaseName.replace(/_\d+$/, '');
        }

        return this.sanitizeName(fileBaseName) || 'sprite';
    }

    private getClassId(className: string): number {
        if (this.classIdsByName[className] === undefined) {
            this.classIdsByName[className] = this.classNames.length;
            this.classNames.push(className);
        }

        return this.classIdsByName[className];
    }

    private getNextSampleIndex(className: string): number {
        if (!this.sampleCountsByClassName[className]) {
            this.sampleCountsByClassName[className] = 0;
        }

        this.sampleCountsByClassName[className]++;
        return this.sampleCountsByClassName[className];
    }

    private sanitizeName(value: string): string {
        if (!value) {
            return '';
        }

        return value
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    private padNumber(value: number, size: number): string {
        let result = value.toString();
        while (result.length < size) {
            result = '0' + result;
        }

        return result;
    }

    private getFilePath(file: File): string {
        const relativePath = (<any>file).webkitRelativePath || file.name;
        return relativePath.replace(/\\/g, '/');
    }

    private pickFirstNonEmptyString(values: any[]): string {
        for (const value of values) {
            if (typeof value === 'string' && value.trim().length > 0) {
                return value.trim();
            }
        }

        return '';
    }

    private async exportFrameCrop(imageData: ImageData, cropRect: Rectangle): Promise<Blob> {
        const canvas = <HTMLCanvasElement>document.createElement('canvas');
        canvas.width = cropRect.width;
        canvas.height = cropRect.height;
        const context = canvas.getContext('2d');
        const sourceCanvas = <HTMLCanvasElement>document.createElement('canvas');
        sourceCanvas.width = imageData.width;
        sourceCanvas.height = imageData.height;
        sourceCanvas.getContext('2d').putImageData(imageData, 0, 0);
        context.drawImage(
            sourceCanvas,
            cropRect.x,
            cropRect.y,
            cropRect.width,
            cropRect.height,
            0,
            0,
            cropRect.width,
            cropRect.height
        );

        const blob = await this.canvasToBlob(canvas);
        canvas.remove();
        sourceCanvas.remove();
        return blob;
    }

    private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
        return new Promise((resolve, reject) => {
            canvas.toBlob(function (blob) {
                if (!blob) {
                    reject(new Error('Canvas blob generation failed'));
                    return;
                }

                resolve(blob);
            });
        });
    }

    private async loadImageData(file: File): Promise<{imageData: ImageData}> {
        return new Promise<{imageData: ImageData}>((resolve, reject) => {
            const image = new Image();
            image.onload = function () {
                const canvas = <HTMLCanvasElement>document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext('2d');
                context.drawImage(image, 0, 0);
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                window.URL.revokeObjectURL(image.src);
                canvas.remove();
                resolve({imageData});
            };
            image.onerror = function () {
                reject(new Error('Failed to load image: ' + file.name));
            };
            image.src = window.URL.createObjectURL(file);
        });
    }

    private async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
        return new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function () {
                resolve(reader.result as ArrayBuffer);
            };
            reader.onerror = function () {
                reject(reader.error);
            };
            reader.readAsArrayBuffer(file);
        });
    }

    private readPngMetadata(arrayBuffer: ArrayBuffer): PngMetadata {
        try {
            const bytes = new Uint8Array(arrayBuffer);
            const decoder = new TextDecoder();
            let offset = 8;
            while (offset + 8 <= bytes.length) {
                const length =
                    (bytes[offset] << 24) |
                    (bytes[offset + 1] << 16) |
                    (bytes[offset + 2] << 8) |
                    bytes[offset + 3];
                const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
                const dataStart = offset + 8;
                const dataEnd = dataStart + length;
                if (type === 'tEXt') {
                    const chunkData = bytes.subarray(dataStart, dataEnd);
                    const nullByteIndex = chunkData.indexOf(0);
                    if (nullByteIndex > 0) {
                        const keyword = decoder.decode(chunkData.subarray(0, nullByteIndex));
                        if (keyword === YoloSegAnnotationGenerator.PNG_TEXT_METADATA_KEYWORD) {
                            const text = decoder.decode(chunkData.subarray(nullByteIndex + 1));
                            return JSON.parse(text);
                        }
                    }
                }

                offset += 12 + length;
            }
        } catch (error) {
            console.error('Failed to parse PNG metadata', error);
        }

        return {};
    }

    private generateDatasetYaml(datasetName: string): string {
        const lines = [
            '# Auto-generated by OpenTibiaLibrary YOLO Segmentation Annotation Generator',
            'path: .',
            'train: images/train',
            'val: images/val',
            'names:'
        ];

        for (let classId = 0; classId < this.classNames.length; classId++) {
            lines.push('  ' + classId + ': ' + this.classNames[classId]);
        }

        lines.push('');
        lines.push('# Suggested dataset name');
        lines.push('dataset_name: ' + datasetName);

        return lines.join('\n');
    }

    private generateReadme(datasetName: string, sourceFileCount: number, validationSplitPercent: number): string {
        return [
            'OpenTibiaLibrary YOLO Segmentation Dataset',
            '',
            'Dataset name: ' + datasetName,
            'Source PNG files: ' + sourceFileCount,
            'Generated samples: ' + this.manifestEntries.length,
            'Classes: ' + this.classNames.length,
            'Validation split: ' + validationSplitPercent + '%',
            '',
            'Structure:',
            '- images/train/<class_name>/*.png',
            '- images/val/<class_name>/*.png',
            '- labels/train/<class_name>/*.txt',
            '- labels/val/<class_name>/*.txt',
            '- classes.txt',
            '- dataset.yaml',
            '- manifest.json',
            '',
            'Label format: YOLO segmentation',
            'Each label file contains one object line with class id and normalized polygon coordinates.',
            '',
            'Frame splitting priority:',
            '1. PNG metadata from OpenTibiaLibrary validated against supported grids',
            '2. Auto grid by PNG height: 32->32x32, 64->64x64, 128->128x128',
            '3. Fixed grid fallback using 32x32, 64x64, 128x64 or 128x128',
            '4. Full image as a single sample',
            '',
            'Class name priority:',
            '1. PNG metadata name fields',
            '2. Parent folder name when it is not generic',
            '3. PNG file name'
        ].join('\n');
    }

    private progressText(text: string) {
        this.progressBar.innerText = text;
    }

    private downloadBlob(filename: string, blob: Blob) {
        const link = document.createElement('a');
        const url = window.URL.createObjectURL(blob);
        link.href = url;
        link.download = filename;
        link.click();
        window.URL.revokeObjectURL(url);
        link.remove();
    }
}

const yoloSegAnnotationGenerator = new YoloSegAnnotationGenerator();
yoloSegAnnotationGenerator.init();
