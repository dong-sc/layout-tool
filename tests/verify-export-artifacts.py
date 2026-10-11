"""Read-only verification of real Dong Tools browser downloads; no native Office UI use."""
import io,json,math,statistics,sys,zipfile
from pathlib import Path
import pymupdf as fitz
from PIL import Image,ImageChops,ImageStat
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
root=Path(sys.argv[1] if len(sys.argv)>1 else Path(__file__).parent.parent/'evidence/exports')
manifest=json.loads((root/'export-manifest.json').read_text());palette=[tuple(bytes.fromhex(c[1:])) for c in manifest['fixtures']]
formats={'ig34':(1080,1440),'ig45':(1080,1350),'ig11':(1080,1080),'igst':(1080,1920)}
report={'jpeg_archives':[],'documents':[],'native_powerpoint':'NOT RUN: native PowerPoint opening and phone hardware are outside this browser verification','failures':[]}
def rgb_median(image):
 pixels=list(image.convert('RGB').resize((64,64),Image.Resampling.NEAREST).get_flattened_data())
 return tuple(statistics.median(p[c] for p in pixels) for c in range(3))
def photo_id(image):
 color=rgb_median(image);d=[math.dist(color,p) for p in palette];i=d.index(min(d));assert d[i]<12,(color,d);return i+1
for case in manifest['cases']:
 for key,multi in [('multiFile',True),('currentFile',False)]:
  if key not in case:continue
  file=root/case[key]
  with zipfile.ZipFile(file)as archive:
   assert archive.testzip()is None
   names=[n for n in archive.namelist()if not n.endswith('/')];assert len(names)==(24 if multi else 6),(file,names)
   expected_names={f'{f}/組{i+1:02d}-{k+1:02d}.jpg' for f in formats for i in range(2)for k in range(3)}if multi else {f'排版-{i+1:02d}-輪播-{k+1:02d}.jpg'for i in range(2)for k in range(3)}
   assert set(names)==expected_names,(file,set(names)^expected_names)
   checked=[];stamp_totals={}
   for name in sorted(names):
    if multi:
     folder,base=name.split('/');parts=base.removeprefix('組').removesuffix('.jpg').split('-');i,k=map(int,parts);expected_size=formats[folder]
    else:
     parts=name.removesuffix('.jpg').split('-');i,k=int(parts[1]),int(parts[3]);expected_size=(1080,1350);folder='current'
    image=Image.open(io.BytesIO(archive.read(name)));image.load();assert image.format=='JPEG';assert image.size==expected_size,(name,image.size)
    detected=photo_id(image);expected=case['expected'][(i-1)*3+k-1];assert detected==expected,(name,detected,expected)
    # A source identity stamp must survive in the decoded JPEG, including the two halves of a cross-page photo.
    gray=image.convert('L');dark=sum(gray.histogram()[:40]);stamp_key=(folder,i,detected);stamp_totals[stamp_key]=stamp_totals.get(stamp_key,0)+dark
    checked.append({'entry':name,'size':image.size,'fixture_id':detected,'stamp_pixels':dark})
   assert all(total>50 for total in stamp_totals.values()),(file,'missing visible photo identity stamp')
   report['jpeg_archives'].append({'file':file.name,'crc':'PASS','entries':checked,'status':'PASS'})
 if 'pdfFile'not in case:continue
 pdf=root/case['pdfFile'];pptx=root/case['pptxFile'];doc=fitz.open(pdf);assert not doc.is_repaired;assert len(doc)==2
 deck=Presentation(pptx)
 with zipfile.ZipFile(pptx)as package:assert package.testzip()is None
 assert len(deck.slides)==2
 expected_emu=(round(case['settings']['w']*36000),round(case['settings']['h']*36000));assert abs(deck.slide_width-expected_emu[0])<=1;assert abs(deck.slide_height-expected_emu[1])<=1
 result={'pdf':pdf.name,'pptx':pptx.name,'pdf_parse':'PASS','pptx_parse':'PASS','pages':2,'slides':2,'slide_size_emu':expected_emu,'pages_checked':[]}
 for i,(page,slide)in enumerate(zip(doc,deck.slides)):
  cells=case['cells'][i];expected_by_id={c['id']:c['rect']for c in cells}
  expected_points=[case['settings'][dim]/25.4*72 for dim in ['w','h']];assert abs(page.rect.width-expected_points[0])<.02;assert abs(page.rect.height-expected_points[1])<.02
  pdf_images=[record for record in page.get_images(full=True)if page.get_image_rects(record[0])];assert len(pdf_images)==len(cells)==3,(pdf.name,i,len(pdf_images),len(cells))
  for record in pdf_images:
   image=Image.open(io.BytesIO(doc.extract_image(record[0])['image']));pid=photo_id(image);rect=expected_by_id[pid];locations=page.get_image_rects(record[0]);assert len(locations)==1
   box=locations[0];wanted=[rect['x'],rect['y'],rect['x']+rect['w'],rect['y']+rect['h']]
   assert max(abs(a-b/25.4*72)for a,b in zip(box,wanted))<.03,(pdf.name,i,pid,list(box),wanted)
  pix=page.get_pixmap(matrix=fitz.Matrix(96/72,96/72),alpha=False);pdf_image=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
  pdf_image.save(root/f'{pdf.stem}-page-{i+1}.png')
  for k in range(3):
   crop=pdf_image.crop((round(k*pix.width/3),0,round((k+1)*pix.width/3),pix.height));assert photo_id(crop)==case['expected'][i*3+k]
  composed=Image.new('RGB',pdf_image.size,'white');seen=[]
  pictures=[s for s in slide.shapes if s.shape_type==MSO_SHAPE_TYPE.PICTURE];assert len(pictures)==len(cells)==3
  for shape,cell in zip(pictures,cells):
   image=Image.open(io.BytesIO(shape.image.blob));image.load();pid=photo_id(image);assert pid==cell['id'],(pptx.name,i,pid,cell['id']);seen.append(pid)
   rect=cell['rect'];actual=[shape.left,shape.top,shape.width,shape.height];expected=[round(rect[v]*36000)for v in ['x','y','w','h']]
   assert max(abs(a-b)for a,b in zip(actual,expected))<=2,(pptx.name,i,pid,actual,expected)
   left=round(shape.left/deck.slide_width*pix.width);top=round(shape.top/deck.slide_height*pix.height);right=round((shape.left+shape.width)/deck.slide_width*pix.width);bottom=round((shape.top+shape.height)/deck.slide_height*pix.height)
   composed.paste(image.convert('RGB').resize((right-left,bottom-top),Image.Resampling.BICUBIC),(left,top))
  composed.save(root/f'{pptx.stem}-ooxml-slide-{i+1}.png')
  mae=sum(ImageStat.Stat(ImageChops.difference(pdf_image,composed)).mean)/3;assert mae<3,(pptx.name,i,'PDF/OOXML visual mismatch',mae)
  result['pages_checked'].append({'page':i+1,'picture_order':seen,'image_rectangles':'PASS','rendered_panel_photos':'PASS','pdf_vs_ooxml_mean_pixel_difference':round(mae,4)})
 result['status']='PASS';report['documents'].append(result);doc.close()
(root/'artifact-verification.json').write_text(json.dumps(report,indent=2));print(f"PASS: {len(report['jpeg_archives'])} archives, {sum(len(a['entries'])for a in report['jpeg_archives'])} actual decoded JPEGs; 2 PDFs (4 pages) and 2 parsed PPTX files (4 slides), complete image rectangles/order verified; PDF and OOXML-derived picture compositions agree. Native PowerPoint opening and phone hardware were not tested in this run.")
