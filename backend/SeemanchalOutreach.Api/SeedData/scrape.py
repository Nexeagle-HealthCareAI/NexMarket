import urllib.request
import re
import json
import uuid

blocks = ["Bahadurganj", "Dighalbank", "Kishanganj", "Kochadhaman", "Pothia", "Terhagachh", "Thakurganj"]
base_url = "https://www.brandbharat.com/english/bihar/districts/Kishanganj/"

results = []

for block in blocks:
    url = f"{base_url}Panchayat_in_{block}_Kishanganj_Bihar.html"
    
    # Try different URL patterns
    urls_to_try = [
        f"https://www.brandbharat.com/english/bihar/districts/Kishanganj/Panchayats_in_{block}_Kishanganj_Bihar.html",
        f"https://www.brandbharat.com/english/bihar/districts/Kishanganj/Panchayat_in_{block}_Kishanganj_Bihar.html",
        f"{base_url}{block}_Panchayats.html",
        f"{base_url}{block}_Panchayat_list.html"
    ]
    
    success = False
    for try_url in urls_to_try:
        req = urllib.request.Request(try_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        try:
            html = urllib.request.urlopen(req).read().decode('utf-8')
            # Extract names from <td>...</td> tags containing 'Panchayat' or just table cells if we can find a pattern
            panchayats = re.findall(r'<td[^>]*>(.*?)</td>', html, re.IGNORECASE | re.DOTALL)
            clean_panchayats = []
            for p in panchayats:
                # Clean up HTML tags within
                p_text = re.sub(r'<[^>]+>', '', p).strip()
                if p_text and p_text.lower() != 'panchayat' and len(p_text) < 50:
                    clean_panchayats.append(p_text)
            
            # Very often the village list links are better: href="...villages.html"
            links = re.findall(r'<a[^>]*href=["\'](?:.*?_villages\.html)["\'][^>]*>(.*?)</a>', html, re.IGNORECASE)
            
            used_list = links if len(links) > 0 else clean_panchayats
            
            for p in used_list:
                p = re.sub(r'<[^>]+>', '', p).strip()
                if p and p.lower() != 'panchayat' and len(p) < 40 and not p.startswith('Click'):
                    # To avoid duplicates
                    if not any(x['name'] == p for x in results):
                        results.append({
                            "id": str(uuid.uuid4()),
                            "lgdCode": "",
                            "name": p,
                            "block": block,
                            "district": "Kishanganj",
                            "state": "Bihar",
                            "centroidLat": None,
                            "centroidLng": None
                        })
            print(f"Scraped {block} from {try_url}: {len(used_list)} possible entries found.")
            success = True
            break
        except Exception as e:
            pass
    if not success:
        print(f"Failed to scrape {block}")

with open("kishanganj_panchayats.json", "w") as f:
    json.dump(results, f, indent=2)

print(f"Total: {len(results)} panchayats.")
