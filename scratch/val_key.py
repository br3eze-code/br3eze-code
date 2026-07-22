
import base64
import os

key_str = os.environ.get('FIREBASE_PRIVATE_KEY', '').replace('\\n', '\n').replace('"', '')
header = "-----BEGIN PRIVATE KEY-----"
footer = "-----END PRIVATE KEY-----"

if header in key_str and footer in key_str:
    body = key_str.split(header)[1].split(footer)[0].strip().replace('\n', '').replace(' ', '')
    try:
        decoded = base64.b64decode(body)
        print(f"Decoded length: {len(decoded)} bytes")
        # PKCS#8 header for RSA is usually around 26 bytes
        # Then the RSA key itself.
        if len(decoded) > 1000:
            print("Length seems correct for RSA-2048")
        else:
            print(f"Length too short: {len(decoded)}")
    except Exception as e:
        print(f"Base64 decode failed: {e}")
else:
    print("Header/Footer not found")
