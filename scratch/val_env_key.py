
import base64
import os

env_path = r'c:\Users\user\br3eze-code\.env'
with open(env_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

key_line = next((l for l in lines if l.startswith('FIREBASE_PRIVATE_KEY=')), None)
if key_line:
    key_val = key_line.split('=', 1)[1].strip().strip('"')
    print(f"Key val starts with: {key_val[:30]}")
    header = "-----BEGIN PRIVATE KEY-----"
    footer = "-----END PRIVATE KEY-----"
    
    # The key_val has literal \n characters (backslash and n)
    key_str = key_val.replace('\\n', '\n')
    
    if header in key_str and footer in key_str:
        body = key_str.split(header)[1].split(footer)[0].strip().replace('\n', '').replace(' ', '')
        try:
            decoded = base64.b64decode(body)
            print(f"Decoded length: {len(decoded)} bytes")
        except Exception as e:
            print(f"Base64 decode failed: {e}")
    else:
        print("Header/Footer not found in processed string")
else:
    print("FIREBASE_PRIVATE_KEY line not found")
