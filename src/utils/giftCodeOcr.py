import cv2
import tesserocr
from PIL import Image
import os
import sys
import re
import json
from datetime import datetime, timezone

TESSDATA_PATH = r"c:\Users\David Jose Cuadra\OneDrive\Documents\web-page\RokTracker-main\deps\tessdata"

# Standard RoK items/rewards to scan for in image OCR
KNOWN_ITEMS = [
    "Gems",
    "Golden Key",
    "Gold Key",
    "Silver Key",
    "Crystal Key",
    "Intermediate Action Point Recovery",
    "Action Point Recovery",
    "Action Points",
    "Tome of Knowledge",
    "Speedup",
    "Food",
    "Wood",
    "Stone",
    "Gold",
    "Dashing Starlight Sculpture",
    "Starlight Sculpture",
    "Universal Sculpture",
    "Sculpture"
]

MONTHS_MAP = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "september": 9, "sept": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12
}

def parse_expiry_date(text):
    """
    Parses expiry date from text and returns a UNIX timestamp (seconds).
    Example input: "15:59 UTC on June 9, 2026"
    """
    # Pattern 1: HH:MM [UTC] on Month DD, YYYY
    pat1 = re.search(r'(\d{1,2}):(\d{2})\s*(?:UTC)?\s*(?:on)?\s*([A-Za-z]+)\s*(\d{1,2}),\s*(\d{4})', text, re.IGNORECASE)
    if pat1:
        hr, mn, mon_str, day, yr = pat1.groups()
        mon = MONTHS_MAP.get(mon_str.lower(), 1)
        try:
            dt = datetime(int(yr), mon, int(day), int(hr), int(mn), tzinfo=timezone.utc)
            return int(dt.timestamp())
        except Exception:
            pass

    # Pattern 2: Month DD, YYYY HH:MM
    pat2 = re.search(r'([A-Za-z]+)\s*(\d{1,2}),\s*(\d{4})\s*(\d{1,2}):(\d{2})', text)
    if pat2:
        mon_str, day, yr, hr, mn = pat2.groups()
        mon = MONTHS_MAP.get(mon_str.lower(), 1)
        try:
            dt = datetime(int(yr), mon, int(day), int(hr), int(mn), tzinfo=timezone.utc)
            return int(dt.timestamp())
        except Exception:
            pass

    # Pattern 3: YYYY-MM-DD
    pat3 = re.search(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})', text)
    if pat3:
        yr, mon, day = pat3.groups()
        try:
            dt = datetime(int(yr), int(mon), int(day), 23, 59, tzinfo=timezone.utc)
            return int(dt.timestamp())
        except Exception:
            pass

    return None

def extract_code(text):
    """
    Extracts the redeem code from text.
    Look for: "Redeem Code: code" or "Code: code" or backticked text.
    """
    # Redeem Code: code
    code_match = re.search(r'(?:Redeem\s*)?Code\s*:\s*[`\'"]?([A-Za-z0-9_]+)[`\'"]?', text, re.IGNORECASE)
    if code_match:
        return code_match.group(1).strip()
    
    # Backticked word fallback: e.g. `lilith13th`
    backticks = re.findall(r'`([^`\s]+)`', text)
    if backticks:
        for val in backticks:
            if len(val) >= 5 and val.lower() != "redeem" and val.lower() != "code":
                return val.strip()

    return None

def parse_rewards_from_ocr(ocr_text):
    """
    Extracts rewards list from OCR text.
    Identifies known item names and parses counts nearby.
    """
    rewards = []
    lines = [line.strip() for line in ocr_text.split('\n') if line.strip()]
    
    # Match numbers e.g. "500", "x500", "500x", "2", "2x"
    for i, line in enumerate(lines):
        for item in KNOWN_ITEMS:
            if re.search(r'\b' + re.escape(item) + r'\b', line, re.IGNORECASE):
                qty = None
                num_match = re.search(r'\b(?:x)?(\d{1,6})(?:x)?\b', line)
                if num_match:
                    val = int(num_match.group(1))
                    if not (val == 1 and line.strip().endswith(" 1")):
                        qty = val
                
                if qty is None and i > 0:
                    prev_line = lines[i-1]
                    num_match_prev = re.search(r'\b(?:x)?(\d{1,6})(?:x)?\b', prev_line)
                    if num_match_prev:
                        qty = int(num_match_prev.group(1))

                if qty is None or qty == 0:
                    qty = 1

                rewards.append(f"{qty}x {item}")
                break

    seen = set()
    deduped = []
    for r in rewards:
        if r not in seen:
            seen.add(r)
            deduped.append(r)
            
    return deduped

def main():
    # Read message text from stdin
    msg_text = sys.stdin.read().strip()
    
    image_path = sys.argv[1] if len(sys.argv) > 1 else ""
    is_file = os.path.exists(image_path) if image_path else False
    
    code = None
    expiry_ts = None
    rewards = []
    
    if msg_text:
        code = extract_code(msg_text)
        expiry_ts = parse_expiry_date(msg_text)
        
    if is_file:
        try:
            img = cv2.imread(image_path)
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            processed = cv2.resize(gray, (0, 0), fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
            
            with tesserocr.PyTessBaseAPI(path=TESSDATA_PATH) as api:
                api.SetImage(Image.fromarray(processed))
                ocr_text = api.GetUTF8Text()
                
            if not code:
                code = extract_code(ocr_text)
            if not expiry_ts:
                expiry_ts = parse_expiry_date(ocr_text)
                
            rewards = parse_rewards_from_ocr(ocr_text)
        except Exception:
            pass
            
    if not rewards and msg_text:
        rewards = parse_rewards_from_ocr(msg_text)
        
    print(json.dumps({
        "success": True,
        "code": code,
        "expiration": expiry_ts,
        "rewards": rewards
    }))

if __name__ == "__main__":
    main()
