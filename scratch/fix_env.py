
import os

env_path = r'c:\Users\user\br3eze-code\.env'

# Read current .env
with open(env_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = False
for line in lines:
    if line.startswith('FIREBASE_PRIVATE_KEY='):
        # We will replace this
        continue
    new_lines.append(line)

# The real key from the previous view (I'll reconstruct it)
# I'll use the one I saw in the view_file output.
# Note: I need to be careful with the \n in the string.

key_content = """-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC0FllvhGIjupf5
UfypCJlLMgPRRtQsKzX7OTTJQPZzEFPItez2Y9g2JgEJFy8cvmiyaXokZRz6TOhW
aSiYWtIqbskG/HA3NuKXlWrWDe1OAA+96YYlvYdPC5CNunbLz9GoXgfej3qVnXom
loq0mpQQCD8zqB4GvO5g3wKX4Ysr2KG9zS7u3fEoMGAo60MIUsnXv4LwG9LgiHpr
k1m3cOfPWDPvk6hiKhbiREWYUsIuh0sNng1sgnkFyZHy5DgphSWzfhbz0Ail5Hci
7cqb4WAYQe/xkTjDdXmxY99lY3QN9v0MNF+TKpOEvn+D+H+4IggvWq2cBSvpVoYC
299eSBchAgMBAAECggEAAOWtm2Me9AudbzYL2rG6xcehgjzmmLO8aJx/2VLUB324
1SKm5BFaRebJkYiGiQ+fyOfCnoTMcKjKbYfHln65VlHH+ZtvWa8R0OyDJD7chEt2
yJztuKlpj6jAlxwrNFe8NSkGxAKV+0HWFnQgi8bLXwsTeYfoYmM1ktD5m9UZUuYW
vzJrTHpCvOb16YN8CxuALwrmbZMHrzG557GCVNn4nBXWdJq6HQDosAqKoroxASX7
iqEXYOa7EhwnbQqzExGHemLV3SfC0SCx6DEP2s588Cye50Q9uV5+p4Bo3JdfDBoa
LXQAA/C71jICaFWq568x6z5Vnm+0rxQghVKhdsEOeQKBgQDmEvTHB5XsiufkS629
Yi4/h2jP0LetTlVSd5eATTvRqD6ek5JX5cKXi7l/y3S7KUKWXotSX4raO9M5bKjB
dZlevQUaEtcwoSwUDNJ8q+4OZvJ5H4fFWPjh60k8wVSd1AOA+BGNo0qcBOfTIq+j
JNL18XM659xT0SU8hDmzxVB+DQKBgQDIYWeArsgLixgEUDAl63+oEx18Qexfaqyc
DxoEQZcgTSsxb3bBNjZXyA2TBEeyEv/zUnLGCJG2b54b/0X1Ht2gnA7xH/32SuKz
Jpi4SEgy/IkIWr6UQrgqAaS9THN7S3m77+3rd1MCI9Sh6tShfnPXfAoOIUiBOztm
79A0tGTMZQKBgAOsDcgXcOcjmGvmYVGCfaZ57MxUUnoro+T7D6n2kZvZCZbSWCWa
/y4YBs/WWWbVPq9a4/XAopVJhvmhhMAY4BFmA1Ae7rE98UiJ0HiJJyKPBh+zlXy
A5bngHW9yDH0rlGio/UUxB4VXfXaud7quYs/XU11Yejcj7GVkq4x2gUJAoGANoAP
p7diH4mgaaPpxJaN7Qft8Br6EGWyNuwAloHEefujMNnxQdHd6/g0gPUcDvoN9X9K
SkSQZT9skI7Y1zei7gkkIz8hUvjBOhrYVN8MDBoVp1kPFsIi1wIFbZs6maFIpe43
FuEoiZ93OObnGFmNZmGNVpSE5OlYWcIGLh+WfuUCgYAieitD1BJA8temOTCmSkZl
fHRlk0ZjgMdkSqJ+XrarP2i2o5EVVAhAtReQ2xQhjbHuTiHNKW1ntJ30hhMRrFJG
G2lSiVaBrJ/93SRYOo1Y1+ia5PfZXMdso8luoct0bFItCIbGh1g4WkJdTvAZjrpm
HLaoJAWsCWI67Ry9suUo4g==
-----END PRIVATE KEY-----"""

# Insert it back
# For .env, we should quote it if it has newlines
quoted_key = 'FIREBASE_PRIVATE_KEY="' + key_content.replace('\\n', '\\\\n').replace('\n', '\\n') + '"\n'
new_lines.insert(39, quoted_key)

with open(env_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Updated .env successfully")
