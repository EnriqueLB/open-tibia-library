import {DatManager} from "./modules/datFile/datManager";
import {OtbManager} from "./modules/otbFile/otbManager";
import {SpriteManager} from "./modules/sprFile/spriteManager";
import {ImageGenerator} from "./modules/imageGenerator/imageGenerator";
import {DatThingCategory, GameFeature} from "./modules/constants/const";
import {WebsiteImageGeneratorBase} from "./websiteImageGeneratorBase";

class ItemImageGenerator extends WebsiteImageGeneratorBase {
    private static readonly PNG_TEXT_METADATA_KEYWORD = 'OpenTibiaLibrary';

    private itemsXmlPicker: HTMLInputElement;
    private onlyPickableCheckbox: HTMLInputElement;
    private forceEnableExtendedSpritesCheckbox: HTMLInputElement;
    private enableTransparencyCheckbox: HTMLInputElement;
    private enableEnhancedAnimationsCheckbox: HTMLInputElement;
    private enableIdleAnimationsCheckbox: HTMLInputElement;
    private useDatItemIdsAsImageIdsCheckbox: HTMLInputElement;

    private itemNamesByServerId: string[] = [];
    private usedExportFileNames: {[fileName: string]: boolean} = {};
    private onlyPickable = true;
    private useDatItemIdsAsImageIds = false;

    init() {
        super.init();
        this.itemsXmlPicker = <HTMLInputElement>document.getElementById('itemsXml');
        this.onlyPickableCheckbox = <HTMLInputElement>document.getElementById('onlyPickable');
        this.forceEnableExtendedSpritesCheckbox = <HTMLInputElement>document.getElementById('forceEnableExtendedSprites');
        this.enableTransparencyCheckbox = <HTMLInputElement>document.getElementById('enableTransparency');
        this.enableEnhancedAnimationsCheckbox = <HTMLInputElement>document.getElementById('enableEnhancedAnimations');
        this.enableIdleAnimationsCheckbox = <HTMLInputElement>document.getElementById('enableIdleAnimations');
        this.useDatItemIdsAsImageIdsCheckbox = <HTMLInputElement>document.getElementById('useDatItemIdsAsImageIds');
    }

    protected loadAdditionalFiles() {
        this.itemNamesByServerId = [];
        if (!this.itemsXmlPicker || this.itemsXmlPicker.files.length === 0) {
            super.loadAdditionalFiles();
            return;
        }

        this.progressText('Loading items.xml file');
        const file = this.itemsXmlPicker.files[0];
        const reader = new FileReader();
        const self = this;
        reader.readAsText(file);
        reader.onload = function (event: any) {
            try {
                self.loadItemNamesFromXml(event.target.result);
                self.progressText('Data loaded. You can click "Generate images" now.');
            } catch (error) {
                console.error('Failed to load items.xml file', error);
                self.progressText('ERROR: Failed to load items.xml file');
            }
        }
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
        this.otbRequired = !this.useDatItemIdsAsImageIdsCheckbox.checked;
    }

    startImageGenerator(imageGenerator: ImageGenerator, otbManager: OtbManager, datManager: DatManager, spriteManager: SpriteManager, zip) {
        this.onlyPickable = this.onlyPickableCheckbox.checked;
        this.useDatItemIdsAsImageIds = this.useDatItemIdsAsImageIdsCheckbox.checked;
        this.usedExportFileNames = {};
        this.generateItemImage(imageGenerator, zip, 0);
    }

    private loadItemNamesFromXml(xmlContent: string) {
        const xmlDocument = new DOMParser().parseFromString(xmlContent, 'text/xml');
        if (xmlDocument.getElementsByTagName('parsererror').length > 0) {
            throw new Error('Invalid XML file');
        }

        const itemNodes = xmlDocument.getElementsByTagName('item');
        for (let itemIndex = 0; itemIndex < itemNodes.length; itemIndex++) {
            const itemNode = itemNodes[itemIndex];
            const itemName = itemNode.getAttribute('name');
            if (!itemName) {
                continue;
            }

            const itemId = parseInt(itemNode.getAttribute('id'), 10);
            if (!isNaN(itemId)) {
                this.itemNamesByServerId[itemId] = itemName;
                continue;
            }

            const fromId = parseInt(itemNode.getAttribute('fromid'), 10);
            const toId = parseInt(itemNode.getAttribute('toid'), 10);
            if (!isNaN(fromId) && !isNaN(toId) && fromId <= toId) {
                for (let rangeItemId = fromId; rangeItemId <= toId; rangeItemId++) {
                    this.itemNamesByServerId[rangeItemId] = itemName;
                }
            }
        }
    }

    private resolveServerItemId(exportedItemId: number, clientItemId: number): number {
        if (!this.useDatItemIdsAsImageIds) {
            return exportedItemId;
        }

        const otbItem = this.otbManager.getItemByClientId(clientItemId);
        if (otbItem) {
            return otbItem.getServerId();
        }

        return null;
    }

    private resolveItemName(exportedItemId: number, clientItemId: number): string {
        const serverItemId = this.resolveServerItemId(exportedItemId, clientItemId);
        if (serverItemId !== null) {
            const itemNameFromXml = this.itemNamesByServerId[serverItemId];
            if (itemNameFromXml) {
                return itemNameFromXml;
            }

            const itemFromOtb = this.otbManager.getItem(serverItemId);
            if (itemFromOtb && itemFromOtb.getName()) {
                return itemFromOtb.getName();
            }
        }

        return '';
    }

    private sanitizeItemName(itemName: string): string {
        return itemName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    private getPreferredItemExportName(exportedItemId: number, clientItemId: number): string {
        const itemName = this.sanitizeItemName(this.resolveItemName(exportedItemId, clientItemId));
        if (itemName.length > 0) {
            return itemName;
        }

        const serverItemId = this.resolveServerItemId(exportedItemId, clientItemId);
        if (serverItemId !== null) {
            return 'item_' + serverItemId;
        }

        return 'item_' + exportedItemId;
    }

    private getUniqueItemExportName(exportedItemId: number, clientItemId: number): string {
        const preferredName = this.getPreferredItemExportName(exportedItemId, clientItemId);
        const serverItemId = this.resolveServerItemId(exportedItemId, clientItemId);
        const fallbackId = serverItemId !== null ? serverItemId : exportedItemId;

        let candidateName = preferredName;
        if (this.usedExportFileNames[candidateName]) {
            candidateName = preferredName + '_' + fallbackId;
        }

        let duplicateIndex = 2;
        while (this.usedExportFileNames[candidateName]) {
            candidateName = preferredName + '_' + fallbackId + '_' + duplicateIndex;
            duplicateIndex++;
        }

        this.usedExportFileNames[candidateName] = true;
        return candidateName;
    }

    private getItemExportFileName(exportedItemId: number, clientItemId: number): string {
        return 'items/' + this.getUniqueItemExportName(exportedItemId, clientItemId) + '.png';
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
            ItemImageGenerator.PNG_TEXT_METADATA_KEYWORD,
            JSON.stringify(metadata)
        );

        const pngWithMetadata = new Uint8Array(pngBytes.length + metadataChunk.length);
        pngWithMetadata.set(pngBytes.subarray(0, iendChunkOffset), 0);
        pngWithMetadata.set(metadataChunk, iendChunkOffset);
        pngWithMetadata.set(pngBytes.subarray(iendChunkOffset), iendChunkOffset + metadataChunk.length);
        return new Blob([pngWithMetadata], {type: 'image/png'});
    }

    generateItemImage(imageGenerator: ImageGenerator, zip, serverId: number) {
        const self = this;
        if (this.useDatItemIdsAsImageIds) {
            this.progressValue(serverId, this.datManager.getCategory(DatThingCategory.ThingCategoryItem).length);
        } else {
            this.progressValue(serverId, this.otbManager.getLastId());
        }
        if ((this.useDatItemIdsAsImageIds && serverId > this.datManager.getCategory(DatThingCategory.ThingCategoryItem).length) ||
            (!this.useDatItemIdsAsImageIds && serverId > this.otbManager.getLastId())) {
            this.progressText('Packing images to ZIP file, please wait (it may take a while)');
            zip.generateAsync({type: "blob"}).then(function (blob: Blob) {
                console.log('zip size', blob.size);
                self.progressText('ZIP generated, it should start download now.');
                self.downloadBlob('items.zip', blob);
            });
            return;
        }

        let clientItemId = serverId;
        if (!this.useDatItemIdsAsImageIds) {
            if (!this.otbManager.isValidOtbId(serverId)) {
                setTimeout(function () {
                    self.generateItemImage(imageGenerator, zip, serverId + 1);
                }, 1);
                return;
            }

            clientItemId = this.otbManager.getItem(serverId).getClientId();
            if (!clientItemId) {
                console.log('otb ID not mapped to any dat ID', serverId);
                setTimeout(function () {
                    self.generateItemImage(imageGenerator, zip, serverId + 1);
                }, 1);
                return;
            }
        }

        let itemThingType = this.datManager.getItem(clientItemId);
        if (!itemThingType) {
            console.log('dat ID not found in dat file', serverId, clientItemId);
            setTimeout(function () {
                self.generateItemImage(imageGenerator, zip, serverId + 1);
            }, 1);
            return;
        }
        if (this.onlyPickable && !itemThingType.isPickupable()) {
            console.log('skip not pickable', serverId);
            setTimeout(function () {
                self.generateItemImage(imageGenerator, zip, serverId + 1);
            }, 1);
            return;
        }

        let itemSprites = null;
        if (this.useDatItemIdsAsImageIds) {
            itemSprites = imageGenerator.generateItemImagesByClientId(serverId);
        } else {
            itemSprites = imageGenerator.generateItemImagesByServerId(serverId);
        }
        if (!itemSprites || itemSprites.length == 0) {
            setTimeout(function () {
                self.generateItemImage(imageGenerator, zip, serverId + 1);
            }, 1);
            return;
        }

        const firstItemSprite = itemSprites[0];
        const canvas = <HTMLCanvasElement>document.createElement('canvas');
        canvas.width = firstItemSprite.getWidth() * itemSprites.length;
        canvas.height = firstItemSprite.getHeight();
        document.getElementsByTagName('body')[0].appendChild(canvas);
        const ctx = canvas.getContext("2d");

        for (let animationFrame = 0; animationFrame < itemSprites.length; animationFrame++) {
            const palette = ctx.getImageData(firstItemSprite.getWidth() * animationFrame, 0, firstItemSprite.getWidth(), firstItemSprite.getHeight());
            const itemSprite = itemSprites[animationFrame];
            palette.data.set(new Uint8ClampedArray(itemSprite.getPixels().m_buffer.buffer));
            ctx.putImageData(palette, firstItemSprite.getWidth() * animationFrame, 0);
        }

        const callback = function (blob) {
            canvas.remove();
            if (!blob) {
                setTimeout(function () {
                    self.generateItemImage(imageGenerator, zip, serverId + 1);
                }, 1);
                return;
            }

            const metadata = {
                exported_id: serverId,
                server_id: self.resolveServerItemId(serverId, clientItemId),
                client_id: clientItemId,
                frames_count: itemSprites.length,
                item_name: self.resolveItemName(serverId, clientItemId)
            };

            self.addPngMetadata(blob, metadata).then(function (pngWithMetadata) {
                zip.file(self.getItemExportFileName(serverId, clientItemId), pngWithMetadata);
                setTimeout(function () {
                    self.generateItemImage(imageGenerator, zip, serverId + 1);
                }, 1);
            }).catch(function (error) {
                console.error('Failed to append PNG metadata', error);
                zip.file(self.getItemExportFileName(serverId, clientItemId), blob);
                setTimeout(function () {
                    self.generateItemImage(imageGenerator, zip, serverId + 1);
                }, 1);
            });

        };
        canvas.toBlob(callback);
    }
}

const itemImageGenerator = new ItemImageGenerator();
itemImageGenerator.init();
