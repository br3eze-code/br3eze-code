# /workers/f1_sim.py
import sys, json, numpy as np, requests
from concurrent.futures import ThreadPoolExecutor

args = json.loads(sys.argv[1])
F1_API = "http://localhost:8000"

# 1. Fetch base data from Tom Shaw API
def get_data():
    grid = requests.get(f"{F1_API}/grid/{args['season']}/{args['round']}").json()
    deg = requests.get(f"{F1_API}/model/tire_deg?season={args['season']}&round={args['round']}").json()
    sc_rate = requests.get(f"{F1_API}/model/sc_rate?season={args['season']}&round={args['round']}").json()['rate']
    return grid, deg, args.get('sc_prob') or sc_rate

grid, deg_model, sc_rate = get_data()
drivers = args.get('grid') or [d['id'] for d in grid]
runs = args['runs']

# 2. Monte Carlo: vectorized numpy for speed
def sim_one_race(seed):
    np.random.seed(seed)
    results = {d: {'time': 0, 'pos': 0} for d in drivers}
    strategy = args.get('strategies', {})

    for lap in range(1, 58): # avg race
        # SC roll
        if np.random.rand() < sc_rate / 57:
            sc_laps = np.random.randint(2,5)
            # everyone pits if window, time loss = 0
            pass

        for d in drivers:
            base_pace = 90.0 + np.random.normal(0, 0.2) # base lap
            tire = strategy.get(d, [['MEDIUM',20],['HARD',37]])[0 if lap < 20 else 1][0]
            age = lap if lap < 20 else lap - 20
            deg = deg_model[tire.lower()] * age
            results[d]['time'] += base_pace + deg + np.random.normal(0, 0.1)

    # Sort by time
    sorted_drivers = sorted(drivers, key=lambda x: results[x]['time'])
    return {d: i+1 for i, d in enumerate(sorted_drivers)}

# 3. Run parallel
with ThreadPoolExecutor() as ex:
    all_results = list(ex.map(sim_one_race, range(runs)))

# 4. Aggregate
win_pct = {d: sum(1 for r in all_results if r[d]==1)/runs*100 for d in drivers}
podium_pct = {d: sum(1 for r in all_results if r[d]<=3)/runs*100 for d in drivers}

summary = {
    'win_pct': dict(sorted(win_pct.items(), key=lambda x:x[1], reverse=True)[:5]),
    'podium_pct': dict(sorted(podium_pct.items(), key=lambda x:x[1], reverse=True)[:5]),
    'sc_rate': sc_rate,
    'most_variable': max(drivers, key=lambda d: np.std([r[d] for r in all_results]))
}

print(json.dumps({"summary": summary, "raw": {"win_pct": win_pct}}))
