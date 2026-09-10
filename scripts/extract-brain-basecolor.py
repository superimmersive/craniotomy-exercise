import json
import os
import struct
from io import BytesIO

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.path.join(ROOT, "assets", "models", "AnatomyHuman.glb")
OUT = os.path.join(ROOT, "assets", "textures", "brain-low-basecolor.jpg")


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(GLB, "rb") as f:
        f.read(12)
        chunk_len = struct.unpack("<I", f.read(4))[0]
        f.read(4)
        gltf = json.loads(f.read(chunk_len))
        bin_len = struct.unpack("<I", f.read(4))[0]
        f.read(4)
        blob = f.read(bin_len)

    image = gltf["images"][1]
    view = gltf["bufferViews"][image["bufferView"]]
    offset = view.get("byteOffset", 0)
    data = blob[offset : offset + view["byteLength"]]
    img = Image.open(BytesIO(data)).convert("RGB")
    img = img.resize((2048, 2048), Image.Resampling.LANCZOS)
    img.save(OUT, "JPEG", quality=88)
    print("wrote", OUT, os.path.getsize(OUT), "from", image.get("name"))


if __name__ == "__main__":
    main()
