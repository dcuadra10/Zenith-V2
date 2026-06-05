import cv2
import tesserocr
from PIL import Image
import os
import sys
import re
import json

TESSDATA_PATH = r"c:\Users\David Jose Cuadra\OneDrive\Documents\web-page\RokTracker-main\deps\tessdata"

def extract_data_from_text(text):
    # 1. Extract Alliance Tag
    alliance_tag = None
    tags = re.findall(r'\[([^\]\s]+)\]', text)
    if tags:
        for t in tags:
            clean_tag = t.strip()
            if 2 <= len(clean_tag) <= 6:
                alliance_tag = clean_tag
                break
    
    # 2. Extract Governor ID
    gov_id = None
    id_match = re.search(r'(?:ID\s*[:;]?\s*)(\d{7,11})', text, re.IGNORECASE)
    if id_match:
        gov_id = id_match.group(1)
    else:
        # Fallback: search for any standalone 7-11 digit number
        digits = re.findall(r'\b\d{7,11}\b', text)
        if digits:
            gov_id = digits[0]
    
    # 3. Extract Governor Name
    gov_name = None
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    for idx, line in enumerate(lines):
        if "governor" in line.lower() and idx + 1 < len(lines):
            candidate = lines[idx+1]
            candidate = re.split(r'[\)\(=:]', candidate)[0].strip()
            candidate = re.sub(r'[©®™\s\(\)\[\]\{\}\|✎•]*$', '', candidate).strip()
            if len(candidate) >= 3:
                gov_name = candidate
                break
    
    # 4. Extract Power and Kill Points
    power = 0
    kp = 0
    numbers = re.findall(r'[\d,]{5,15}', text)
    clean_numbers = []
    for num in numbers:
        val = re.sub(r'[^\d]', '', num)
        if val:
            clean_numbers.append(int(val))
            
    if gov_id:
        clean_numbers = [n for n in clean_numbers if str(n) != gov_id]
        
    if len(clean_numbers) >= 2:
        large_nums = sorted(clean_numbers, reverse=True)
        power_match = re.search(r'Power\s+([\d,]+)', text, re.IGNORECASE)
        kp_match = re.search(r'(?:Kill\s*Points|Points)\s+([\d,]+)', text, re.IGNORECASE)
        
        if power_match:
            power = int(re.sub(r'[^\d]', '', power_match.group(1)))
        if kp_match:
            kp = int(re.sub(r'[^\d]', '', kp_match.group(1)))
            
        if power == 0 and large_nums:
            power = large_nums[0]
        if kp == 0 and len(large_nums) > 1:
            kp = large_nums[1]

    return {
        "success": True,
        "allianceTag": alliance_tag,
        "governorName": gov_name,
        "governorId": gov_id,
        "power": power,
        "killPoints": kp
    }

def process_screenshot(img_path):
    if not os.path.exists(img_path):
        return {"success": False, "error": "Image file not found"}
        
    try:
        img = cv2.imread(img_path)
        h, w, c = img.shape
        
        # Pass 1: Try full image (scaled 2x)
        gray_full = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        processed_full = cv2.resize(gray_full, (0, 0), fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
        
        text_full = ""
        with tesserocr.PyTessBaseAPI(path=TESSDATA_PATH) as api:
            api.SetImage(Image.fromarray(processed_full))
            text_full = api.GetUTF8Text()
            
        result_full = extract_data_from_text(text_full)
        
        # If we successfully found both alliance tag and governor ID on the full image, use it!
        if result_full.get("allianceTag") and result_full.get("governorId"):
            return result_full
            
        # Pass 2: If it's a horizontal (Tablet/PC) image and Pass 1 didn't find all info,
        # crop to the central profile modal region.
        if w > h:
            left = int(w * 0.30)
            top = int(h * 0.20)
            width = int(w * 0.50)
            height = int(h * 0.30)
            
            crop = img[top:top+height, left:left+width]
            gray_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            processed_crop = cv2.resize(gray_crop, (0, 0), fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
            
            text_crop = ""
            with tesserocr.PyTessBaseAPI(path=TESSDATA_PATH) as api:
                api.SetImage(Image.fromarray(processed_crop))
                text_crop = api.GetUTF8Text()
                
            result_crop = extract_data_from_text(text_crop)
            
            # Merge results: use crop results if they are better/contain the allianceTag
            if result_crop.get("allianceTag") or result_crop.get("governorId"):
                # Fill missing details from full pass if crop pass missed them
                for key in ["allianceTag", "governorName", "governorId", "power", "killPoints"]:
                    if not result_crop.get(key) and result_full.get(key):
                        result_crop[key] = result_full[key]
                return result_crop
                
        # Return full pass result if crop wasn't applicable or crop also failed
        return result_full
        
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing image path argument"}))
        sys.exit(1)
        
    result = process_screenshot(sys.argv[1])
    print(json.dumps(result))
