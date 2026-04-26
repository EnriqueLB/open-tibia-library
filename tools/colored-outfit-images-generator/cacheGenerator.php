<?php

require_once('./config.php');

$dirIterator = new RecursiveDirectoryIterator($outfitImagesPath, FilesystemIterator::UNIX_PATHS);
$iterator = new RecursiveIteratorIterator($dirIterator, RecursiveIteratorIterator::SELF_FIRST);

$outfits = [];
$outfitFolders = [];
$folderMetadata = [];
$i = 0;
foreach ($iterator as $file)
{
	if ($file->isFile())
	{
        $filePath = trim($file->getPath(), '.');
        $filePath = trim(str_replace('\\', '/', $filePath), '/');
		$outfitIdData = explode('/', $filePath);
        if (count($outfitIdData) < 2) {
            continue;
        }

        $outfitFolderName = $outfitIdData[1];
        if (!isset($folderMetadata[$outfitFolderName])) {
            $folderMetadataPath = $outfitImagesPath . '/' . $outfitFolderName . '/outfit.metadata.json';
            if (file_exists($folderMetadataPath)) {
                $decodedMetadata = json_decode(file_get_contents($folderMetadataPath), true);
                if (is_array($decodedMetadata) && isset($decodedMetadata['id'])) {
                    $folderMetadata[$outfitFolderName] = $decodedMetadata;
                } else {
                    $folderMetadata[$outfitFolderName] = null;
                }
            } elseif (is_numeric($outfitFolderName)) {
                $folderMetadata[$outfitFolderName] = ['id' => (int) $outfitFolderName, 'folder' => $outfitFolderName];
            } else {
                $folderMetadata[$outfitFolderName] = null;
            }
        }

        if (!isset($folderMetadata[$outfitFolderName]['id'])) {
            continue;
        }

		$outfitId = (int) $folderMetadata[$outfitFolderName]['id'];
        $outfitFolders[$outfitId] = $outfitFolderName;
        if (isset($folderMetadata[$outfitFolderName]['file_map']) && is_array($folderMetadata[$outfitFolderName]['file_map'])) {
            $outfits[$outfitId]['fileMap'] = $folderMetadata[$outfitFolderName]['file_map'];
        }
		$outfits[$outfitId]['files'][] = $filePath . '/' . $file->getFilename();
        $fileName = $file->getFilename();
        $prefix = $outfitFolderName . '_';
        if (strpos($fileName, $prefix) === 0) {
            $fileName = substr($fileName, strlen($prefix));
        }

        if (preg_match('/^(\d+)(?:_|\.png)/', $fileName, $fileNameMatches)) {
            $animationFrame = (int) $fileNameMatches[1];
            if(isset($outfits[$outfitId]['framesNumber']))
			    $outfits[$outfitId]['framesNumber'] = max($outfits[$outfitId]['framesNumber'], $animationFrame);
		    else
			    $outfits[$outfitId]['framesNumber'] = $animationFrame;
        } elseif (!isset($outfits[$outfitId]['framesNumber'])) {
            $outfits[$outfitId]['framesNumber'] = 1;
        }
    }
}

// CODE TO CHECK WHAT VALUES OF 'framesNumber' ARE POSSIBLE FOR YOUR OUTFITS
$frameNumbers = [0,0,0,0,0,0,0,0,0,0];
foreach($outfits as $outfitId => $outfit)
{
    $outfitFolderName = $outfitFolders[$outfitId];
    $outfit['folder'] = $outfitFolderName;
	if (!file_put_contents($outfitImagesPath . '/' . $outfitFolderName . '/outfit.data.txt', serialize($outfit))) {
	    exit('PHP cannot write to: "' . $outfitImagesPath . '/' . $outfitFolderName . '/outfit.data.txt", check directory access rights');
    }
	$frameNumbers[$outfit['framesNumber']]++;
}

if (!file_put_contents($outfitImagesPath . '/outfit.cache.index.json', json_encode($outfitFolders))) {
    exit('PHP cannot write to: "' . $outfitImagesPath . '/outfit.cache.index.json", check directory access rights');
}

if (!file_put_contents('./cache.generated.txt', 'cache generated')) {
    exit('PHP cannot write to: "./cache.generated.txt", check directory access rights');
}
echo 'FILE SYSTEM CACHE GENERATED<br />Animation frames count in loaded outfits:';
var_dump($frameNumbers);
