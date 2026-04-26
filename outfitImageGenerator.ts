import {DatManager} from "./modules/datFile/datManager";
import {OtbManager} from "./modules/otbFile/otbManager";
import {SpriteManager} from "./modules/sprFile/spriteManager";
import {ImageGenerator} from "./modules/imageGenerator/imageGenerator";
import {DatThingCategory, FrameGroupType, GameFeature} from "./modules/constants/const";
import {WebsiteImageGeneratorBase} from "./websiteImageGeneratorBase";
import {OutfitImagePhpGeneratorCode} from "./outfitImagePhpGeneratorCode";

class OutfitImageGenerator extends WebsiteImageGeneratorBase {
    private monsterFolderPicker: HTMLInputElement;
    private idleAnimationCheckbox: HTMLInputElement;
    private forceEnableExtendedSpritesCheckbox: HTMLInputElement;
    private enableTransparencyCheckbox: HTMLInputElement;
    private enableEnhancedAnimationsCheckbox: HTMLInputElement;
    private enableIdleAnimationsCheckbox: HTMLInputElement;

    private outfitNamesById: {[outfitId: number]: string[]} = {};
    private usedOutfitFolderNames: {[folderName: string]: boolean} = {};
    private outfitFolderNamesById: {[outfitId: number]: string} = {};
    private outfitExportMetadataById: {[outfitId: number]: any} = {};
    private outfitFileMapById: {[outfitId: number]: {[logicalFileName: string]: string}} = {};
    private outfitFileCountById: {[outfitId: number]: number} = {};
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
        this.usedOutfitFolderNames = {};
        this.outfitFolderNamesById = {};
        this.outfitExportMetadataById = {};
        this.outfitFileMapById = {};
        this.outfitFileCountById = {};
        this.generateOutfitImage(imageGenerator, otbManager, datManager, zip, 0);
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

        this.addOutfitName(outfitId, monsterName);
    }

    private addOutfitName(outfitId: number, outfitName: string) {
        if (!this.outfitNamesById[outfitId]) {
            this.outfitNamesById[outfitId] = [];
        }

        if (this.outfitNamesById[outfitId].indexOf(outfitName) === -1) {
            this.outfitNamesById[outfitId].push(outfitName);
        }
    }

    private sanitizeOutfitName(outfitName: string): string {
        return outfitName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    private getOutfitAliases(outfitId: number): string[] {
        return this.outfitNamesById[outfitId] || [];
    }

    private getPreferredOutfitFolderName(outfitId: number): string {
        const aliases = this.getOutfitAliases(outfitId);
        if (aliases.length > 0) {
            const sanitizedName = this.sanitizeOutfitName(aliases[0]);
            if (sanitizedName.length > 0) {
                return sanitizedName;
            }
        }

        return 'outfit_' + outfitId;
    }

    private getOutfitFolderName(outfitId: number): string {
        if (this.outfitFolderNamesById[outfitId]) {
            return this.outfitFolderNamesById[outfitId];
        }

        const preferredFolderName = this.getPreferredOutfitFolderName(outfitId);
        let folderName = preferredFolderName;
        if (this.usedOutfitFolderNames[folderName]) {
            folderName = preferredFolderName + '_' + outfitId;
        }

        let duplicateIndex = 2;
        while (this.usedOutfitFolderNames[folderName]) {
            folderName = preferredFolderName + '_' + outfitId + '_' + duplicateIndex;
            duplicateIndex++;
        }

        this.usedOutfitFolderNames[folderName] = true;
        this.outfitFolderNamesById[outfitId] = folderName;
        return folderName;
    }

    private getOutfitOutputDirectory(outfitId: number): string {
        return 'outfits_anim/' + this.getOutfitFolderName(outfitId);
    }

    private getOutfitFileBaseName(outfitId: number): string {
        return this.getOutfitFolderName(outfitId);
    }

    private getOutfitExportMetadata(outfitId: number) {
        const aliases = this.getOutfitAliases(outfitId);
        return {
            id: outfitId,
            folder: this.getOutfitFolderName(outfitId),
            name: aliases.length > 0 ? aliases[0] : '',
            aliases: aliases,
            file_map: this.outfitFileMapById[outfitId] || {}
        };
    }

    private getLogicalOutfitFileName(originalFileName: string): string {
        if (originalFileName.endsWith('_template')) {
            return originalFileName.substring(0, originalFileName.length - '_template'.length);
        }

        return originalFileName;
    }

    private getOrCreateOutfitMappedFileBaseName(outfitId: number, originalFileName: string): string {
        const logicalFileName = this.getLogicalOutfitFileName(originalFileName);
        if (!this.outfitFileMapById[outfitId]) {
            this.outfitFileMapById[outfitId] = {};
        }
        if (!this.outfitFileCountById[outfitId]) {
            this.outfitFileCountById[outfitId] = 0;
        }

        if (!this.outfitFileMapById[outfitId][logicalFileName]) {
            this.outfitFileCountById[outfitId]++;
            this.outfitFileMapById[outfitId][logicalFileName] = this.getOutfitFileBaseName(outfitId) + '_' + this.outfitFileCountById[outfitId];
        }

        return this.outfitFileMapById[outfitId][logicalFileName];
    }

    private getRenamedOutfitFileName(outfitId: number, originalFileName: string): string {
        const isTemplateFile = originalFileName.endsWith('_template');
        let renamedFileName = this.getOrCreateOutfitMappedFileBaseName(outfitId, originalFileName);
        if (isTemplateFile) {
            renamedFileName += '_template';
        }

        return renamedFileName;
    }

    private prepareOutfitFileMappings(outfitId: number, outfitSprites: any[]) {
        for (let outfitSprite of outfitSprites) {
            const originalDirectory = 'outfits_anim/' + outfitId + '/';
            const originalFileName = outfitSprite.file.indexOf(originalDirectory) === 0
                ? outfitSprite.file.substring(originalDirectory.length)
                : outfitSprite.file;
            this.getRenamedOutfitFileName(outfitId, originalFileName);
        }
    }

    private mapOutfitSpriteFilePath(outfitId: number, originalFilePath: string): string {
        const originalDirectory = 'outfits_anim/' + outfitId + '/';
        const originalFileName = originalFilePath.indexOf(originalDirectory) === 0 ? originalFilePath.substring(originalDirectory.length) : originalFilePath;
        return this.getOutfitOutputDirectory(outfitId) + '/' + this.getRenamedOutfitFileName(outfitId, originalFileName);
    }

    generateOutfitImage(imageGenerator: ImageGenerator, otbManager: OtbManager, datManager: DatManager, zip, outfitId: number) {
        const self = this;
        this.progressValue(outfitId, datManager.getCategory(DatThingCategory.ThingCategoryCreature).length);
        if (outfitId > datManager.getCategory(DatThingCategory.ThingCategoryCreature).length) {
            this.progressText('Packing images to ZIP file, please wait (it may take a while)');

            zip.file('outfits_anim/outfit.index.json', JSON.stringify(this.outfitExportMetadataById));

            const outfitImagePhpGeneratorCode = new OutfitImagePhpGeneratorCode();
            outfitImagePhpGeneratorCode.addFilesToZip(zip);

            zip.generateAsync({type: "blob"}).then(function (blob: Blob) {
                console.log('zip size', blob.size);
                self.progressText('ZIP generated, it should start download now.');
                self.downloadBlob('outfits.zip', blob);
            });
            return;
        }

        let outfitSprites;
        if (this.idleAnimation) {
            outfitSprites = imageGenerator.generateOutfitAnimationImages(outfitId, FrameGroupType.FrameGroupIdle);
        }
        if (!outfitSprites || outfitSprites.length == 0) {
            outfitSprites = imageGenerator.generateOutfitAnimationImages(outfitId, FrameGroupType.FrameGroupMoving);
        }
        if (!outfitSprites || outfitSprites.length == 0) {
            setTimeout(function () {
                self.generateOutfitImage(imageGenerator, otbManager, datManager, zip, outfitId + 1);
            }, 1);
            return;
        }

        this.prepareOutfitFileMappings(outfitId, outfitSprites);
        let outfitThingType = this.datManager.getOutfit(outfitId);
        const outfitExportMetadata = this.getOutfitExportMetadata(outfitId);
        this.outfitExportMetadataById[outfitId] = outfitExportMetadata;
        zip.file(this.getOutfitOutputDirectory(outfitId) + '/outfit.metadata.json', JSON.stringify(outfitExportMetadata));
        if (outfitThingType && outfitThingType.hasBones()) {
            zip.file(this.getOutfitOutputDirectory(outfitId) + '/bones.json', JSON.stringify(outfitThingType.getBones()));
        }

        let spritesToProcess = outfitSprites.length;
        for (let outfitSprite of outfitSprites) {
            const canvas = <HTMLCanvasElement>document.createElement('canvas');
            canvas.width = outfitSprite.sprite.getWidth();
            canvas.height = outfitSprite.sprite.getHeight();
            document.getElementsByTagName('body')[0].appendChild(canvas);
            const ctx = canvas.getContext("2d");
            const palette = ctx.getImageData(0, 0, outfitSprite.sprite.getWidth(), outfitSprite.sprite.getHeight());
            palette.data.set(new Uint8ClampedArray(outfitSprite.sprite.getPixels().m_buffer.buffer));
            ctx.putImageData(palette, 0, 0);
            if (self.imageFormat == 'png') {
                const callback = function (blob) {
                    canvas.remove();
                    zip.file(self.mapOutfitSpriteFilePath(outfitId, outfitSprite.file) + '.png', blob);
                    spritesToProcess--;
                    if (spritesToProcess == 0) {
                        setTimeout(function () {
                            self.generateOutfitImage(imageGenerator, otbManager, datManager, zip, outfitId + 1);
                        }, 1);
                    }
                };
                canvas.toBlob(callback);
            }
        }

    }
}

const outfitImageGenerator = new OutfitImageGenerator();
outfitImageGenerator.init();
