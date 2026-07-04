Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$pngPath = Join-Path $root 'build\icon.png'
$icoPath = Join-Path $root 'build\icon.ico'
$sizes = @(16, 32, 48, 256)

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
        [System.Collections.Generic.List[byte[]]]$Images
    )

    $stream = [System.IO.File]::Create($Path)
    $writer = New-Object System.IO.BinaryWriter($stream)

    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$Images.Count)

    $offset = 6 + (16 * $Images.Count)
    foreach ($imageBytes in $Images) {
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$imageBytes.Length)
        $writer.Write([UInt32]$offset)
        $offset += $imageBytes.Length
    }

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

    Save-PngIco -Path $icoPath -Images $pngImages
    Write-Host "Created $icoPath ($((Get-Item $icoPath).Length) bytes)"
}
finally {
    $source.Dispose()
}
