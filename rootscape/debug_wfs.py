import requests

urls = [
    "https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json&typeName=ogdwien:VERSIEGELUNGOGD&maxFeatures=1",
    "https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json&typeName=ogdwien:BODENKARTEOGD&maxFeatures=1",
    "https://data.wien.gv.at/daten/geo?service=WFS&request=GetFeature&version=1.1.0&srsName=EPSG:4326&outputFormat=json&typeName=ogdwien:GEWAESSEROGD&maxFeatures=1"
]

for url in urls:
    print(f"\nTesting: {url}")
    try:
        r = requests.get(url, timeout=30)
        print(f"Status: {r.status_code}")
        print(f"Content-Type: {r.headers.get('Content-Type')}")
        print(f"Body (first 1000 chars):\n{r.text[:1000]}")
    except Exception as e:
        print(f"Error: {e}")
