from pathlib import Path
from io import BytesIO
from PIL import Image
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Union, List, Tuple
import mimetypes, os, time, uuid, threading

# pip install google-genai pillow python-dotenv
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

# ---------- small thread-safe logger ----------
_print_lock = threading.Lock()
def log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)

# ---------- prompt ----------
TEMPLATE = """TASK
You are an image editor. You will be given TWO images after this text:
1) BASE image (no instruction boxes) — use only for context and to infer content hidden by boxes.
2) BOXED image (with black/white instruction boxes) — THIS IS THE EDITING TARGET.

First, if provided, apply the GLOBAL DIRECTIVE to the whole scene (both images’ content should be consistent with the directive).
Then read every instruction box in the BOXED image, perform those edits on the BOXED image, and finally remove all boxes from the BOXED image.

GLOBAL DIRECTIVE (optional, scene-wide)
• VALUE: "{GLOBAL_DIRECTIVE}"

WHAT COUNTS AS A BOX (in the BOXED image)
• A dark/black semi-transparent rectangle with white text.
• Use the box center as the anchor; affect the box area (expand up to ~3× if needed).

ALLOWED ACTIONS (case-insensitive)
• ADD / REMOVE / REPLACE A WITH B / SWAP TO <style>.

EDITING RULES
• Edit ONLY the BOXED image; use the BASE image to reconstruct anything occluded by boxes or text.
• Preserve composition; change only what is requested by boxes or the global directive.
• Match lighting, shadows, reflections, textures, perspective, DOF.
• Respect occlusions; cast plausible shadows.
• If local box instructions conflict with the global directive, local instructions take precedence in their region.
• Apply multiple boxes in order: REMOVE → REPLACE → ADD → SWAP.
• After all edits, remove every instruction box completely (no outlines, no text).

VARIATION HINT
• Produce a distinct but valid variant #{VAR} by varying only non-essential attributes (crop/viewpoint, subtle grade/DOF, micro-lighting). Do not add new elements beyond the requested edits.

OUTPUT
• Return the edited IMAGE only (the edited BOXED image) — no overlays, no captions, no borders, no boxes.
"""

# ---------- helpers ----------
_FORMAT_TO_MIME = {
    "PNG":  "image/png",
    "JPEG": "image/jpeg",
    "JPG":  "image/jpeg",
    "WEBP": "image/webp",
    "BMP":  "image/bmp",
    "TIFF": "image/tiff",
    "TIF":  "image/tiff",
}
_FORMAT_TO_SUFFIX = {
    "PNG":  ".png",
    "JPEG": ".jpg",
    "JPG":  ".jpg",
    "WEBP": ".webp",
    "BMP":  ".bmp",
    "TIFF": ".tiff",
    "TIF":  ".tiff",
}

def _build_prompt(global_str: str, variant_idx: int) -> str:
    g = (global_str or "").strip()
    return TEMPLATE.replace("{GLOBAL_DIRECTIVE}", g if g else "NONE").replace("{VAR}", str(variant_idx))

def _infer_mime_and_suffix_from_bytes(photo_bytes: bytes, filename_hint: Optional[str]) -> Tuple[str, str]:
    mime_hint = suffix_hint = None
    if filename_hint:
        mime_hint, _ = mimetypes.guess_type(filename_hint)
        suffix_hint = Path(filename_hint).suffix.lower() or None
    with Image.open(BytesIO(photo_bytes)) as im:
        fmt = (im.format or "").upper()
    mime_pil   = _FORMAT_TO_MIME.get(fmt)
    suffix_pil = _FORMAT_TO_SUFFIX.get(fmt)
    mime   = mime_hint or mime_pil or "image/png"
    suffix = suffix_hint or suffix_pil or ".png"
    return mime, suffix

def _download_file_bytes(client: genai.Client, file_uri: str) -> bytes:
    for kw in ("name", "file"):
        try:
            return client.files.download(**{kw: file_uri})
        except TypeError:
            continue
    raise TypeError("files.download() signature not recognized; update google-genai.")

def _extract_image_from_response(resp, client: genai.Client) -> Tuple[Optional[bytes], Optional[str]]:
    # inline_data
    for cand in getattr(resp, "candidates", []) or []:
        parts = getattr(getattr(cand, "content", None), "parts", []) or []
        for part in parts:
            if getattr(part, "inline_data", None):
                data = part.inline_data.data
                mt = getattr(part.inline_data, "mime_type", None) or "image/png"
                return data, mt
    # file_data
    for cand in getattr(resp, "candidates", []) or []:
        parts = getattr(getattr(cand, "content", None), "parts", []) or []
        for part in parts:
            fd = getattr(part, "file_data", None)
            if fd and getattr(fd, "file_uri", None):
                data = _download_file_bytes(client, fd.file_uri)
                mt = getattr(fd, "mime_type", None) or "image/png"
                return data, mt
    return None, None

# ---------- main (two-image, bytes API) ----------
def generate_four_edits_from_two_bytes(
    boxed_bytes: bytes,            # image WITH instruction boxes (target to edit)
    base_bytes: bytes,             # original image WITHOUT boxes (for de-occlusion/context)
    global_directive: str,
    *,
    boxed_filename_hint: Optional[str] = None,   # e.g., "scene_with_boxes.png"
    base_filename_hint: Optional[str] = None,    # e.g., "scene_base.png"
    outputs_dir: Union[str, Path] = "server/storage/outputs",
    model_name: str = "gemini-2.5-flash-image-preview",
    temperature: float = 0.4,
    max_workers: int = 4,
    api_key: Optional[str] = None,
    client: Optional[genai.Client] = None,
) -> List[Path]:
    """
    Generate FOUR edited variants using TWO input images:
      - BASE (no boxes): context only
      - BOXED (with boxes): the image to edit
    Saves outputs to outputs_dir and returns list of Paths.
    """
    total_t0 = time.perf_counter()
    _client: genai.Client = client or genai.Client(api_key=api_key or os.getenv("GEMINI_API_KEY"))

    # Infer formats; output naming is based on the BOXED image
    boxed_mime, boxed_suffix = _infer_mime_and_suffix_from_bytes(boxed_bytes, boxed_filename_hint)
    base_mime,  _            = _infer_mime_and_suffix_from_bytes(base_bytes,  base_filename_hint)

    boxed_kb = len(boxed_bytes) / 1024.0
    base_kb  = len(base_bytes)  / 1024.0

    base_stem  = Path(base_filename_hint).stem  if base_filename_hint  else "base"
    boxed_stem = Path(boxed_filename_hint).stem if boxed_filename_hint else "boxed"
    run_stem   = f"{boxed_stem}_{uuid.uuid4().hex[:8]}"

    outputs_dir = Path(outputs_dir); outputs_dir.mkdir(parents=True, exist_ok=True)

    # Create reusable inline Parts (order matters for our prompt references)
    part_base  = types.Part.from_bytes(data=base_bytes,  mime_type=base_mime)
    part_boxed = types.Part.from_bytes(data=boxed_bytes, mime_type=boxed_mime)

    log(f"[{run_stem}] INPUTS: BASE={base_kb:.1f} KB ({base_mime}), BOXED={boxed_kb:.1f} KB ({boxed_mime})")

    def _one_variant(i: int) -> Path:
        prompt = _build_prompt(global_directive, i)
        out_path = outputs_dir / f"{run_stem}_v{i}{boxed_suffix}"

        backoff = 1.0
        last_err: Optional[Exception] = None
        for attempt in range(1, 5):
            try:
                call_t0 = time.perf_counter()
                log(f"[{run_stem} v{i}] CALL attempt {attempt} → model={model_name}, temp={temperature}")
                # Order: prompt, BASE (context), BOXED (target)
                resp = _client.models.generate_content(
                    model=model_name,
                    contents=[prompt, part_base, part_boxed],
                    config=types.GenerateContentConfig(
                        response_modalities=["IMAGE"],
                        temperature=temperature,
                    ),
                )
                call_dt = time.perf_counter() - call_t0
                log(f"[{run_stem} v{i}] RECV ← {call_dt:.2f}s")

                img_bytes, _ = _extract_image_from_response(resp, _client)
                if not img_bytes:
                    raise RuntimeError("No image bytes returned (safety/decoding).")

                Image.open(BytesIO(img_bytes)).save(out_path)
                log(f"[{run_stem} v{i}] SAVED → {out_path}")
                return out_path

            except Exception as e:
                last_err = e
                log(f"[{run_stem} v{i}] RETRY {attempt} error: {e}")
                time.sleep(backoff)
                backoff = min(backoff * 2, 8.0)

        raise RuntimeError(f"Variant {i} failed after retries: {last_err}")

    # Run 4 variants in parallel
    saved: List[Path] = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = [ex.submit(_one_variant, i) for i in range(1, 5)]
        for fut in as_completed(futures):
            try:
                saved.append(fut.result())
            except Exception as e:
                log(f"[{run_stem}] [WARN] {boxed_filename_hint or 'boxed'}: {e}")

    total_dt = time.perf_counter() - total_t0
    log(f"[{run_stem}] SUMMARY: {len(saved)}/4 variant(s) in {total_dt:.2f}s")

    if not saved:
        raise RuntimeError("All variants failed.")
    return sorted(saved)

# ---------- convenience wrapper: open two files then call bytes-API ----------
def generate_four_edits_from_files(
    boxed_image_path: Union[str, Path],   # path to the BOXED (with boxes) image
    base_image_path:  Union[str, Path],   # path to the BASE (no boxes) image
    global_directive: str,
    **kwargs,
) -> List[Path]:
    """
    Wrapper that reads two image files, then calls generate_four_edits_from_two_bytes().
    kwargs are forwarded (outputs_dir, model_name, temperature, etc.).
    """
    boxed_path = Path(boxed_image_path)
    base_path  = Path(base_image_path)

    if not boxed_path.exists():
        raise FileNotFoundError(boxed_path)
    if not base_path.exists():
        raise FileNotFoundError(base_path)

    with open(boxed_path, "rb") as fb:
        boxed_bytes = fb.read()
    with open(base_path, "rb") as fa:
        base_bytes = fa.read()

    return generate_four_edits_from_two_bytes(
        boxed_bytes=boxed_bytes,
        base_bytes=base_bytes,
        global_directive=global_directive,
        boxed_filename_hint=boxed_path.name,
        base_filename_hint=base_path.name,
        **kwargs,
    )

# EXAMPLE USAGE:
# paths = generate_four_edits_from_files(
#     boxed_image_path="server/storage/images/2.png",
#     base_image_path="originals/2.png",
#     global_directive="Change the weather from summer to winter",
#     outputs_dir="server/storage/outputs",
# )
# print("\nSaved files:")
# for p in paths:
#     print(" -", p)