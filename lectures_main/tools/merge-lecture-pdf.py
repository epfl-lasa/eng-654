#!/usr/bin/env python3
"""Merge Chromium's one-slide PDFs, preserving text and slide bookmarks."""
import json
import sys
import zlib
from pathlib import Path
from pypdf import PdfReader, PdfWriter, PageObject
from pypdf.generic import DictionaryObject, NameObject, NumberObject, EncodedStreamObject, DecodedStreamObject
from PIL import Image

manifest_path, output = map(Path, sys.argv[1:])
manifest = json.loads(manifest_path.read_text())
writer = PdfWriter()
for index, slide in enumerate(sorted(manifest['pages'], key=lambda page: page['number'])):
    reader = PdfReader(manifest_path.parent / slide['file'])
    if len(reader.pages) != 1:
        raise ValueError(f"Slide {slide['number']} has {len(reader.pages)} pages")
    writer.add_page(reader.pages[0])
    if slide.get('screenshot'):
        # Browser screenshots preserve composited WebGL and absolute-positioned
        # scenes exactly. Native PDF text below this visible layer stays searchable.
        bitmap = Image.open(manifest_path.parent / slide['screenshot']).convert('RGB')
        image = EncodedStreamObject()
        image._data = zlib.compress(bitmap.tobytes(), 6)
        image.update({NameObject('/Type'): NameObject('/XObject'),
                      NameObject('/Subtype'): NameObject('/Image'),
                      NameObject('/Width'): NumberObject(bitmap.width),
                      NameObject('/Height'): NumberObject(bitmap.height),
                      NameObject('/ColorSpace'): NameObject('/DeviceRGB'),
                      NameObject('/BitsPerComponent'): NumberObject(8),
                      NameObject('/Filter'): NameObject('/FlateDecode')})
        width, height = map(float, (writer.pages[-1].mediabox.width, writer.pages[-1].mediabox.height))
        snapshot = PageObject.create_blank_page(width=width, height=height)
        snapshot[NameObject('/Resources')] = DictionaryObject({NameObject('/XObject'): DictionaryObject({NameObject('/Snapshot'): writer._add_object(image)})})
        content = DecodedStreamObject()
        content.set_data(f'q {width} 0 0 {height} 0 0 cm /Snapshot Do Q'.encode())
        snapshot[NameObject('/Contents')] = content
        writer.pages[-1].merge_page(snapshot)
    writer.add_outline_item(f"{slide['number']:02d} · {slide['title']}", index)
writer.add_metadata({'/Title': manifest['title'], '/Author': 'ENG-654',
                     '/Subject': 'Final revealed slide snapshots',
                     '/Creator': 'ENG-654 lecture PDF exporter'})
writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)
output.parent.mkdir(parents=True, exist_ok=True)
with output.open('wb') as stream:
    writer.write(stream)
print(f"Saved {output.name}: {len(writer.pages)} slides, {output.stat().st_size / 1048576:.1f} MiB")
