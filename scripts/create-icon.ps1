Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$pngPath = Join-Path $root 'build\icon.png'
$icoPath = Join-Path $root 'build\icon.ico'
$sizes = @(16, 32, 48, 64, 256)

function New-SquareBitmap {
    param(
        [System.Drawing.Image]$Source,
        [int]$Size
    )

    $square = New-Object System.Drawing.Bitmap $Size, $Size
    $graphics = [System.Drawing.Graphics]::FromImage($square)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $cropSize = [Math]::Min($Source.Width, $Source.Height)
    $cropX = [Math]::Floor(($Source.Width - $cropSize) / 2)
    $cropY = [Math]::Floor(($Source.Height - $cropSize) / 2)
    $sourceRect = New-Object System.Drawing.Rectangle $cropX, $cropY, $cropSize, $cropSize
    $destRect = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size

    $graphics.DrawImage($Source, $destRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Dispose()
    return $square
}

function Save-PngIco {
    param(
        [string]$Path,
        [int[]]$Sizes,
        [System.Collections.Generic.List[byte[]]]$Images
    )

    $stream = [System.IO.File]::Create($Path)
    $writer = New-Object System.IO.BinaryWriter($stream)

    # ICONDIR header
    $writer.Write([UInt16]0)   # reserved
    $writer.Write([UInt16]1)   # type = ICO
    $writer.Write([UInt16]$Images.Count)

    # ICONDIRENTRY records (16 bytes each)
    $offset = 6 + (16 * $Images.Count)
    for ($i = 0; $i -lt $Images.Count; $i++) {
        $size = $Sizes[$i]
        # ICO spec: width/height byte = 0 means 256, otherwise literal pixel value
        $sizeByte = [byte]$(if ($size -eq 256) { 0 } else { $size })
        $writer.Write($sizeByte)                    # width
        $writer.Write($sizeByte)                    # height
        $writer.Write([byte]0)                      # color palette (0 = no palette)
        $writer.Write([byte]0)                      # reserved
        $writer.Write([UInt16]1)                     # color planes
        $writer.Write([UInt16]32)                    # bits per pixel
        $writer.Write([UInt32]$Images[$i].Length)    # image data size
        $writer.Write([UInt32]$offset)              # image data offset
        $offset += $Images[$i].Length
    }

    # Image data (PNG blobs)
    foreach ($imageBytes in $Images) {
        $writer.Write($imageBytes)
    }

    $writer.Close()
    $stream.Close()
}

$source = [System.Drawing.Image]::FromFile($pngPath)
$pngImages = New-Object 'System.Collections.Generic.List[byte[]]'

try {
    foreach ($size in $sizes) {
        $bitmap = New-SquareBitmap -Source $source -Size $size
        $memoryStream = New-Object System.IO.MemoryStream
        $bitmap.Save($memoryStream, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngImages.Add($memoryStream.ToArray()) | Out-Null
        $memoryStream.Dispose()
        $bitmap.Dispose()
    }

    Save-PngIco -Path $icoPath -Sizes $sizes -Images $pngImages
    Write-Host "Created $icoPath ($((Get-Item $icoPath).Length) bytes)"
}
finally {
    $source.Dispose()
}
