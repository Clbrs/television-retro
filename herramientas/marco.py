# Recorta la pantalla (y el fondo exterior) de la foto de la tele para dejarlos transparentes.
import sys, numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB'); a = np.asarray(im).astype(int); h, w, _ = a.shape
blanco = a.min(axis=2) > 200
lab, _ = ndimage.label(blanco)
pantalla = lab == lab[h // 2, int(w * 0.43)]
borde = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
fuera = np.isin(lab, list(borde))
pantalla = ndimage.binary_dilation(pantalla, iterations=2)
fuera = ndimage.binary_dilation(fuera, iterations=1)
alfa = np.where(pantalla | fuera, 0, 255).astype(np.uint8)
alfa = np.asarray(Image.fromarray(alfa).filter(ImageFilter.GaussianBlur(0.8)))
ys, xs = np.where(pantalla)
print('pantalla bbox', xs.min(), xs.max(), ys.min(), ys.max(), 'img', w, h)
print('css left %.3f%% top %.3f%% width %.3f%% height %.3f%%' % (xs.min()/w*100, ys.min()/h*100, (xs.max()-xs.min()+1)/w*100, (ys.max()-ys.min()+1)/h*100))
out = Image.fromarray(np.dstack([a.astype(np.uint8), alfa]), 'RGBA')
out = out.resize((w * 2, h * 2), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 60, 2))
out.save(dst, optimize=True)
