<?php

include_once(__DIR__ . '/apngCreator.php');

abstract class AbstractPngConverterAnimation
{
    protected const PNG_TEXT_METADATA_KEYWORD = 'OpenTibiaLibrary';
    protected static $transparentBackgroundColor = [255, 255, 255, 127];
    /**
     * @var string
     */
    protected $inputPath;
    /**
     * @var bool
     */
    protected $printProgress;
    /**
     * @var bool
     */
    private $loadFolder;

    /**
     * @param string $inputPath
     */
    public function __construct($inputPath, $printProgress = true, $loadFolder = false)
    {
        $this->inputPath = $inputPath;
        $this->printProgress = $printProgress;
        $this->loadFolder = $loadFolder;
    }

    /**
     * @param string $saveToPath
     * @param float $animationFrameDurationInSeconds
     * @throws Exception
     */
    public abstract function convert($saveToPath, $animationFrameDurationInSeconds = 0.2);

    protected function getInputFiles()
    {
        if ($this->loadFolder) {
            foreach ($this->getFilesFromFolder() as $fileName => $fileContents) {
                yield $fileName => $fileContents;
            }
        } else {
            foreach ($this->getFilesFromZip() as $fileName => $fileContents) {
                yield $fileName => $fileContents;
            }
        }
    }

    protected function getFilesFromZip()
    {
        $zip = new ZipArchive();
        if ($zip->open($this->inputPath) === true) {
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $fileName = $zip->getNameIndex($i);

                $fileHandler = $zip->getStream($fileName);
                if ($fileHandler === false) {
                    throw new InvalidArgumentException('Failed to read ZIP file: ' . $fileName);
                }
                $fileContents = stream_get_contents($fileHandler);
                if ($fileContents === false) {
                    throw new InvalidArgumentException('Failed to read ZIP file contents: ' . $fileName);
                }
                fclose($fileHandler);

                yield $fileName => $fileContents;
            }
            $zip->close();
        } else {
            throw new InvalidArgumentException('Failed to open ZIP archive.');
        }
    }

    protected function getFilesFromFolder()
    {
        $recursiveDirectoryIterator = new RecursiveDirectoryIterator($this->inputPath);
        $recursiveIterator = new RecursiveIteratorIterator($recursiveDirectoryIterator);

        foreach ($recursiveIterator as $file) {
            if (is_file($file)) {
                yield $file->getPathname() => file_get_contents($file);
            }
        }
    }

    protected function getExportedItemData($fileName, $fileContents)
    {
        $metadata = $this->getPngExportMetadata($fileContents);
        if (is_array($metadata) && isset($metadata['exported_id'])) {
            $itemId = (string) $metadata['exported_id'];
            $framesCount = 1;
            if (isset($metadata['frames_count'])) {
                $framesCount = max(1, (int) $metadata['frames_count']);
            }

            return [$itemId, $framesCount];
        }

        $fileBaseName = basename($fileName);
        $fileNameWithoutExtension = substr($fileBaseName, 0, -4);
        $fileNameData = explode('_', $fileNameWithoutExtension);
        $itemId = $fileNameData[0];
        $framesCount = 1;
        if (isset($fileNameData[1])) {
            $framesCount = intval($fileNameData[1]);
        }

        return [$itemId, max(1, $framesCount)];
    }

    protected function getPngExportMetadata($fileContents)
    {
        if (substr($fileContents, 0, 8) !== "\x89PNG\x0D\x0A\x1A\x0A") {
            return null;
        }

        $offset = 8;
        $fileLength = strlen($fileContents);

        while ($offset + 8 <= $fileLength) {
            $chunkLengthData = substr($fileContents, $offset, 4);
            if (strlen($chunkLengthData) !== 4) {
                return null;
            }

            $chunkLength = unpack('N', $chunkLengthData)[1];
            $chunkType = substr($fileContents, $offset + 4, 4);
            $chunkDataOffset = $offset + 8;
            $nextChunkOffset = $chunkDataOffset + $chunkLength + 4;
            if ($nextChunkOffset > $fileLength) {
                return null;
            }

            if ($chunkType === 'tEXt') {
                $chunkData = substr($fileContents, $chunkDataOffset, $chunkLength);
                $separatorPosition = strpos($chunkData, "\0");
                if ($separatorPosition !== false) {
                    $keyword = substr($chunkData, 0, $separatorPosition);
                    if ($keyword === self::PNG_TEXT_METADATA_KEYWORD) {
                        $jsonMetadata = substr($chunkData, $separatorPosition + 1);
                        $decodedMetadata = json_decode($jsonMetadata, true);
                        if (is_array($decodedMetadata)) {
                            return $decodedMetadata;
                        }
                    }
                }
            }

            if ($chunkType === 'IEND') {
                break;
            }

            $offset = $nextChunkOffset;
        }

        return null;
    }
}
