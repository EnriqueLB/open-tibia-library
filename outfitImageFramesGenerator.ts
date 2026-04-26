import {DatManager} from "./modules/datFile/datManager";
import {OtbManager} from "./modules/otbFile/otbManager";
import {SpriteManager} from "./modules/sprFile/spriteManager";
import {ImageGenerator} from "./modules/imageGenerator/imageGenerator";
import {DatThingCategory, FrameGroupType, GameFeature} from "./modules/constants/const";
import {WebsiteImageGeneratorBase} from "./websiteImageGeneratorBase";

class OutfitImageFramesGenerator extends WebsiteImageGeneratorBase {
    private static readonly PNG_TEXT_METADATA_KEYWORD = 'OpenTibiaLibrary';

    private monsterFolderPicker: HTMLInputElement;
    private idleAnimationCheckbox: HTMLInputElement;
    private forceEnableExtendedSpritesCheckbox: HTMLInputElement;
    private enableTransparencyCheckbox: HTMLInputElement;
    private enableEnhancedAnimationsCheckbox: HTMLInputElement;
    private enableIdleAnimationsCheckbox: HTMLInputElement;

    private outfitNamesById: {[outfitId: number]: string[]} = {};
    private usedExportFileNames: {[fileName: string]: boolean} = {};
    private idleAnimation = true;

    init() {
        this.otbRequired = false;
        super.init();
        this.monsterFolderPicker = <HTMLInputElement>document.getElementById('monsterFolder');
        this.idleAnimationCheckbox = <HTMLInputElement>document.getElementById('idleAnimation');
        this.forceEnableExtendedSpritesCheckbox = <HTMLInputElement>document.getElementById('forceEnableExtendedSprites');
        this.enableTransparencyCheckbox = <HTMLInputElement>document.getElementById('enableTransparency');
        this.enableEnhancedAnimationsCheckbox = <HTMLInputElement>document.getElementById('enableEnhancedAnimations');
        this.enableIdleAnimationsCheckbox = <HTMLInputElement>document.getElementById('enableIdleAnimations');
    }

    afterSetClientVersion() {
        if (this.forceEnableExtendedSpritesCheckbox.checked) {
            this.client.enableFeature(GameFeature.GameSpritesU32);
        }
        if (this.enableTransparencyCheckbox.checked) {
            this.client.enableFeature(GameFeature.GameSpritesAlphaChannel);
        }
        if (this.enableEnhancedAnimationsCheckbox.checked) {
            this.client.enableFeature(GameFeature.GameEnhancedAnimations);
        }
        if (this.enableIdleAnimationsCheckbox.checked) {
            this.client.enableFeature(GameFeature.GameIdleAnimations);
        }
    }

    protected loadAdditionalFiles() {
        this.outfitNamesById = {};
        if (!this.monsterFolderPicker || this.monsterFolderPicker.files.length === 0) {
            super.loadAdditionalFiles();
            return;
        }

        const monsterXmlFiles: File[] = [];
        for (let fileIndex = 0; fileIndex < this.monsterFolderPicker.files.length; fileIndex++) {
            const file = this.monsterFolderPicker.files[fileIndex];
            if (file.name.toLowerCase().endsWith('.xml')) {
                monsterXmlFiles.push(file);
            }
        }

        if (monsterXmlFiles.length === 0) {
            super.loadAdditionalFiles();
            return;
        }

        this.progressText('Loading monster XML files');
        this.loadMonsterNamesFromFiles(monsterXmlFiles, 0);
    }

    startImageGenerator(imageGenerator: ImageGenerator, otbManager: OtbManager, datManager: DatManager, spriteManager: SpriteManager, zip) {
        this.idleAnimation = this.idleAnimationCheckbox.checked;
        this.usedExportFileNames = {};
        this.generateOutfitImage(imageGenerator, datManager, zip, 0);
    }

    private loadMonsterNamesFromFiles(monsterXmlFiles: File[], fileIndex: number) {
        if (fileIndex >= monsterXmlFiles.length) {
            super.loadAdditionalFiles();
            return;
        }

        const self = this;
        const reader = new FileReader();
        reader.onload = function (event: any) {
            try {
                self.loadMonsterNameFromXml(event.target.result);
            } catch (error) {
                console.error('Failed to parse monster XML file', monsterXmlFiles[fileIndex].name, error);
            }

            if ((fileIndex + 1) % 100 === 0 || fileIndex + 1 === monsterXmlFiles.length) {
                self.progressText('Loading monster XML files (' + (fileIndex + 1) + '/' + monsterXmlFiles.length + ')');
            }

            setTimeout(function () {
                self.loadMonsterNamesFromFiles(monsterXmlFiles, fileIndex + 1);
            }, 0);
        };
        reader.onerror = function () {
            console.error('Failed to read monster XML file', monsterXmlFiles[fileIndex].name, reader.error);
            setTimeout(function () {
                self.loadMonsterNamesFromFiles(monsterXmlFiles, fileIndex + 1);
            }, 0);
        };
        reader.readAsText(monsterXmlFiles[fileIndex]);
    }

    private loadMonsterNameFromXml(xmlContent: string) {
        const xmlDocument = new DOMParser().parseFromString(xmlContent, 'text/xml');
        if (xmlDocument.getElementsByTagName('parsererror').length > 0) {
            return;
        }

        const monsterNode = xmlDocument.getElementsByTagName('monster')[0];
        if (!monsterNode) {
            return;
        }

        const lookNode = monsterNode.getElementsByTagName('look')[0];
        if (!lookNode) {
            return;
        }

        const outfitId = parseInt(lookNode.getAttribute('type'), 10);
        const monsterName = monsterNode.getAttribute('name');
        if (isNaN(outfitId) || !monsterName) {
            return;
        }

        if (!this.outfitNamesById[outfitId]) {
            this.outfitNamesById[outfitId] = [];
        }
        if (this.outfitNamesById[outfitId].indexOf(monsterName) === -1) {
            this.outfitNamesById[outfitId].push(monsterName);
        }
    }

    private getOutfitAliases(outfitId: number): string[] {
        return this.outfitNamesById[outfitId] || [];
    }

    private sanitizeOutfitName(outfitName: string): string {
        return outfitName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    private getPreferredOutfitExportName(outfitId: number): string {
        const aliases = this.getOutfitAliases(outfitId);
        if (aliases.length > 0) {
            const sanitizedName = this.sanitizeOutfitName(aliases[0]);
            if (sanitizedName.length > 0) {
                return sanitizedName;
            }
        }

        return 'outfit_' + outfitId;
    }

    private getUniqueOutfitExportName(outfitId: number): string {
        const preferredName = this.getPreferredOutfitExportName(outfitId);
        let candidateName = preferredName;
        if (this.usedExportFileNames[candidateName]) {
            candidateName = preferredName + '_' + outfitId;
        }

        let duplicateIndex = 2;
        while (this.usedExportFileNames[candidateName]) {
            candidateName = preferredName + '_' + outfitId + '_' + duplicateIndex;
            duplicateIndex++;
        }

        this.usedExportFileNames[candidateName] = true;
        return candidateName;
    }

    private getOutfitExportFileName(outfitExportName: string, direction: number): string {
        return 'outfits/' + outfitExportName + '_' + direction + '.png';
    }

    private parseOutfitSpriteFile(fileName: string): {
        animationPhase: number,
        mountState: number,
        addon: number,
        direction: number,
        isTemplate: boolean
    } | null {
        const matches = fileName.match(/\/(\d+)_(\d+)_(\d+)_(\d+)(?:(_template))?$/);
        if (!matches) {
            return null;
        }

        return {
            animationPhase: parseInt(matches[1], 10),
            mountState: parseInt(matches[2], 10),
            addon: parseInt(matches[3], 10),
            direction: parseInt(matches[4], 10),
            isTemplate: matches[5] === '_template'
        };
    }

    private getAnimationSpritesByDirection(outfitSprites: any[]): Array<{
        direction: number,
        sprites: any[]
    }> {
        const spritesByDirection: {[direction: number]: any[]} = {};

        for (const outfitSprite of outfitSprites) {
            const spriteData = this.parseOutfitSpriteFile(outfitSprite.file);
            if (!spriteData || spriteData.isTemplate) {
                continue;
            }
            if (spriteData.mountState !== 1 || spriteData.addon !== 1) {
                continue;
            }

            if (!spritesByDirection[spriteData.direction]) {
                spritesByDirection[spriteData.direction] = [];
            }

            spritesByDirection[spriteData.direction].push({
                file: outfitSprite.file,
                sprite: outfitSprite.sprite,
                animationPhase: spriteData.animationPhase
            });
        }

        return Object.keys(spritesByDirection)
            .map(direction => parseInt(direction, 10))
            .sort((a, b) => a - b)
            .map(direction => ({
                direction,
                sprites: spritesByDirection[direction].sort((left, right) => left.animationPhase - right.animationPhase)
            }));
    }

    private getTotalDirectionFrames(directionSprites: Array<{direction: number, sprites: any[]}>): number {
        let totalFrames = 0;
        for (const directionSprite of directionSprites) {
            totalFrames += directionSprite.sprites.length;
        }

        return totalFrames;
    }

    private getPreferredAnimationFrames(
        imageGenerator: ImageGenerator,
        outfitId: number
    ): {
        directionSprites: Array<{direction: number, sprites: any[]}>,
        frameGroupType: FrameGroupType
    } | null {
        let idleDirectionSprites: Array<{direction: number, sprites: any[]}> = [];
        if (this.idleAnimation) {
            const idleSprites = imageGenerator.generateOutfitAnimationImages(outfitId, FrameGroupType.FrameGroupIdle);
            if (idleSprites && idleSprites.length > 0) {
                idleDirectionSprites = this.getAnimationSpritesByDirection(idleSprites);
            }
        }

        let movingDirectionSprites: Array<{direction: number, sprites: any[]}> = [];
        const movingSprites = imageGenerator.generateOutfitAnimationImages(outfitId, FrameGroupType.FrameGroupMoving);
        if (movingSprites && movingSprites.length > 0) {
            movingDirectionSprites = this.getAnimationSpritesByDirection(movingSprites);
        }

        const movingFrameCount = this.getTotalDirectionFrames(movingDirectionSprites);
        const idleFrameCount = this.getTotalDirectionFrames(idleDirectionSprites);

        if (movingFrameCount > 0 && movingFrameCount >= idleFrameCount) {
            return {
                directionSprites: movingDirectionSprites,
                frameGroupType: FrameGroupType.FrameGroupMoving
            };
        }

        if (idleFrameCount > 0) {
            return {
                directionSprites: idleDirectionSprites,
                frameGroupType: FrameGroupType.FrameGroupIdle
            };
        }

        return null;
    }

    private readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function () {
                resolve(reader.result as ArrayBuffer);
            };
            reader.onerror = function () {
                reject(reader.error);
            };
            reader.readAsArrayBuffer(blob);
        });
    }

    private findPngChunkOffset(bytes: Uint8Array, chunkType: string): number {
        let offset = 8;
        while (offset + 8 <= bytes.length) {
            const length =
                (bytes[offset] << 24) |
                (bytes[offset + 1] << 16) |
                (bytes[offset + 2] << 8) |
                bytes[offset + 3];
            const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
            if (type === chunkType) {
                return offset;
            }
            offset += 12 + length;
        }

        return -1;
    }

    private getPngCrc32(bytes: Uint8Array): number {
        let crc = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) {
            crc ^= bytes[i];
            for (let bit = 0; bit < 8; bit++) {
                if ((crc & 1) !== 0) {
                    crc = (crc >>> 1) ^ 0xEDB88320;
                } else {
                    crc = crc >>> 1;
                }
            }
        }

        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    private createPngTextChunk(keyword: string, text: string): Uint8Array {
        const encoder = new TextEncoder();
        const keywordBytes = encoder.encode(keyword);
        const textBytes = encoder.encode(text);
        const chunkData = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
        chunkData.set(keywordBytes, 0);
        chunkData[keywordBytes.length] = 0;
        chunkData.set(textBytes, keywordBytes.length + 1);

        const chunkType = encoder.encode('tEXt');
        const crcInput = new Uint8Array(chunkType.length + chunkData.length);
        crcInput.set(chunkType, 0);
        crcInput.set(chunkData, chunkType.length);
        const crc = this.getPngCrc32(crcInput);

        const chunk = new Uint8Array(12 + chunkData.length);
        const view = new DataView(chunk.buffer);
        view.setUint32(0, chunkData.length);
        chunk.set(chunkType, 4);
        chunk.set(chunkData, 8);
        view.setUint32(8 + chunkData.length, crc);
        return chunk;
    }

    private async addPngMetadata(blob: Blob, metadata: {[key: string]: any}): Promise<Blob> {
        const pngBytes = new Uint8Array(await this.readBlobAsArrayBuffer(blob));
        const iendChunkOffset = this.findPngChunkOffset(pngBytes, 'IEND');
        if (iendChunkOffset === -1) {
            return blob;
        }

        const metadataChunk = this.createPngTextChunk(
            OutfitImageFramesGenerator.PNG_TEXT_METADATA_KEYWORD,
            JSON.stringify(metadata)
        );

        const pngWithMetadata = new Uint8Array(pngBytes.length + metadataChunk.length);
        pngWithMetadata.set(pngBytes.subarray(0, iendChunkOffset), 0);
        pngWithMetadata.set(metadataChunk, iendChunkOffset);
        pngWithMetadata.set(pngBytes.subarray(iendChunkOffset), iendChunkOffset + metadataChunk.length);
        return new Blob([pngWithMetadata], {type: 'image/png'});
    }

    private exportOutfitDirections(
        zip,
        outfitId: number,
        outfitExportName: string,
        frameGroupType: FrameGroupType,
        directionSprites: Array<{direction: number, sprites: any[]}>,
        directionIndex: number,
        onComplete: () => void
    ) {
        if (directionIndex >= directionSprites.length) {
            onComplete();
            return;
        }

        const self = this;
        const currentDirectionSprites = directionSprites[directionIndex];
        const firstOutfitSprite = currentDirectionSprites.sprites[0].sprite;
        const canvas = <HTMLCanvasElement>document.createElement('canvas');
        canvas.width = firstOutfitSprite.getWidth() * currentDirectionSprites.sprites.length;
        canvas.height = firstOutfitSprite.getHeight();
        document.getElementsByTagName('body')[0].appendChild(canvas);
        const ctx = canvas.getContext("2d");

        for (let spriteIndex = 0; spriteIndex < currentDirectionSprites.sprites.length; spriteIndex++) {
            const palette = ctx.getImageData(firstOutfitSprite.getWidth() * spriteIndex, 0, firstOutfitSprite.getWidth(), firstOutfitSprite.getHeight());
            const outfitSprite = currentDirectionSprites.sprites[spriteIndex].sprite;
            palette.data.set(new Uint8ClampedArray(outfitSprite.getPixels().m_buffer.buffer));
            ctx.putImageData(palette, firstOutfitSprite.getWidth() * spriteIndex, 0);
        }

        const spriteFiles = currentDirectionSprites.sprites.map(outfitSprite => outfitSprite.file);
        const metadata = {
            outfit_id: outfitId,
            outfit_name: this.getOutfitAliases(outfitId).length > 0 ? this.getOutfitAliases(outfitId)[0] : '',
            aliases: this.getOutfitAliases(outfitId),
            direction: currentDirectionSprites.direction,
            sprites_count: currentDirectionSprites.sprites.length,
            frame_group_type: frameGroupType,
            sprite_files: spriteFiles
        };

        const callback = function (blob) {
            canvas.remove();
            if (!blob) {
                self.exportOutfitDirections(zip, outfitId, outfitExportName, frameGroupType, directionSprites, directionIndex + 1, onComplete);
                return;
            }

            self.addPngMetadata(blob, metadata).then(function (pngWithMetadata) {
                zip.file(self.getOutfitExportFileName(outfitExportName, currentDirectionSprites.direction), pngWithMetadata);
                self.exportOutfitDirections(zip, outfitId, outfitExportName, frameGroupType, directionSprites, directionIndex + 1, onComplete);
            }).catch(function (error) {
                console.error('Failed to append PNG metadata', error);
                zip.file(self.getOutfitExportFileName(outfitExportName, currentDirectionSprites.direction), blob);
                self.exportOutfitDirections(zip, outfitId, outfitExportName, frameGroupType, directionSprites, directionIndex + 1, onComplete);
            });
        };
        canvas.toBlob(callback);
    }

    generateOutfitImage(imageGenerator: ImageGenerator, datManager: DatManager, zip, outfitId: number) {
        const self = this;
        this.progressValue(outfitId, datManager.getCategory(DatThingCategory.ThingCategoryCreature).length);
        if (outfitId > datManager.getCategory(DatThingCategory.ThingCategoryCreature).length) {
            this.progressText('Packing images to ZIP file, please wait (it may take a while)');
            zip.generateAsync({type: "blob"}).then(function (blob: Blob) {
                console.log('zip size', blob.size);
                self.progressText('ZIP generated, it should start download now.');
                self.downloadBlob('outfit_frames.zip', blob);
            });
            return;
        }

        const preferredAnimationFrames = this.getPreferredAnimationFrames(imageGenerator, outfitId);
        if (!preferredAnimationFrames) {
            setTimeout(function () {
                self.generateOutfitImage(imageGenerator, datManager, zip, outfitId + 1);
            }, 1);
            return;
        }

        if (preferredAnimationFrames.directionSprites.length === 0) {
            setTimeout(function () {
                self.generateOutfitImage(imageGenerator, datManager, zip, outfitId + 1);
            }, 1);
            return;
        }

        const outfitExportName = this.getUniqueOutfitExportName(outfitId);
        this.exportOutfitDirections(
            zip,
            outfitId,
            outfitExportName,
            preferredAnimationFrames.frameGroupType,
            preferredAnimationFrames.directionSprites,
            0,
            function () {
            setTimeout(function () {
                self.generateOutfitImage(imageGenerator, datManager, zip, outfitId + 1);
            }, 1);
        });
    }
}

const outfitImageFramesGenerator = new OutfitImageFramesGenerator();
outfitImageFramesGenerator.init();
