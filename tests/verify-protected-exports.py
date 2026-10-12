from pathlib import Path
import json,sys,zipfile,io
from PIL import Image
import fitz
from pptx import Presentation
root=Path(sys.argv[1] if len(sys.argv)>1 else 'evidence/protected-area')
manifest=json.loads((root/'exports.json').read_text())
expected=(242,237,226)
def check_image(im,a,label):
 im=im.convert('RGB');x=round((a['x']+a['w']/2)*im.width);y=round((a['y']+a['h']/2)*im.height)
 rgb=im.getpixel((x,y));assert max(abs(rgb[i]-expected[i]) for i in range(3))<=6,(label,rgb)
 # Sample a grid inside the area: no photos, dashed outline or editor label.
 for fx in [.1,.3,.5,.7,.9]:
  for fy in [.1,.3,.5,.7,.9]:
   rgb=im.getpixel((round((a['x']+a['w']*fx)*im.width),round((a['y']+a['h']*fy)*im.height)))
   assert max(abs(rgb[i]-expected[i]) for i in range(3))<=6,(label,fx,fy,rgb)
for case in manifest:
 a=case['area'];check_image(Image.open(root/case['jpeg']),a,case['jpeg'])
 if case['pdf']:
  doc=fitz.open(root/case['pdf']);assert len(doc)==1
  pix=doc[0].get_pixmap(matrix=fitz.Matrix(2,2));check_image(Image.open(io.BytesIO(pix.tobytes('png'))),a,case['pdf'])
 if case['pptx']:
  deck=Presentation(root/case['pptx']);assert len(deck.slides)==1
  overlay=deck.slides[0].shapes[-1]
  assert overlay.left==0 and overlay.top==0
  assert abs(overlay.width-deck.slide_width)<10 and abs(overlay.height-deck.slide_height)<10
  check_image(Image.open(io.BytesIO(overlay.image.blob)),a,case['pptx'])
 print(case['name']+': decoded JPEG'+(', rendered PDF and parsed PPTX overlay' if case['pdf'] else '')+' have solid blank area without editor markings PASS')
