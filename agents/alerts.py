# /workers/alerts.py
import json, time, requests, os
from pathlib import Path

ALERT_PATH = '.agentos/f1/alerts.json'
STATE_PATH = '.agentos/f1/pitwall_*.json'

def send_push(user, msg, webhook=None):
    if webhook: # Discord/Slack
        requests.post(webhook, json={"content": f"🏁 {msg}"})
    else: # mock push - in prod use FCM/APNs
        print(f"PUSH {user}: {msg}")

def check_alerts():
    if not Path(ALERT_PATH).exists(): return
    subs = json.loads(open(ALERT_PATH).read())['subs']

    for user, sub in subs.items():
        # Check pit windows via pit_wall snapshot
        if 'pit_window' in sub['events']:
            out = os.popen(f"agentos agentos.pit_wall action:snapshot season:{sub['season']}").read()
            data = json.loads(out)
            for u in data['updates']:
                if not sub['drivers'] or u['driver'] in sub['drivers']:
                    if u['call'] == 'BOX' and u.get('pit_window'):
                        send_push(user, f"{u['driver']} PIT WINDOW L{u['pit_window'][0]}-{u['pit_window'][-1]}", sub.get('webhook'))

        # Check SC via race_engineer
        if 'sc' in sub['events']:
            out = os.popen(f"agentos agentos.race_engineer action:pit_window season:{sub['season']} track_status:SC").read()
            data = json.loads(out)
            if data.get('risk_if_SC') == 'high':
                send_push(user, f"SAFETY CAR! Free pit stop window", sub.get('webhook'))

        # Check news via news monitor
        if 'news' in sub['events']:
            out = os.popen(f"agentos agentos.news action:alert query:''").read()
            data = json.loads(out)
            for a in data.get('new_articles', []):
                if not sub['drivers'] or any(d in a['title'] for d in sub['drivers']):
                    send_push(user, f"NEWS: {a['title']}", sub.get('webhook'))

if __name__ == '__main__':
    while True:
        try: check_alerts()
        except: pass
        time.sleep(5) # poll every 5s
