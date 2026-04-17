# /workers/sql.py
import sys, json, pandas as pd, sqlalchemy as sa
args = json.loads(sys.argv[1])

def get_engine():
    if args['db'] == 'sqlite': return sa.create_engine(f"sqlite:///{args['conn']}")
    if args['db'] == 'duckdb': return sa.create_engine(f"duckdb:///{args['conn']}")
    return sa.create_engine(args['conn']) # postgres/mysql URL

if 'sql_connect' in sys.argv[0]:
    eng = get_engine()
    tables = pd.read_sql("SELECT name FROM sqlite_master WHERE type='table'", eng)['name'].tolist() if args['db']=='sqlite' else \
             pd.read_sql("SELECT table_name FROM information_schema.tables WHERE table_schema='public'", eng)['table_name'].tolist()
    print(json.dumps({"tables": tables}))

elif 'sql_schema' in sys.argv[0]:
    eng = get_engine()
    if args['db']=='sqlite':
        cols = pd.read_sql(f"PRAGMA table_info({args['table']})", eng)[['name','type','pk']].to_dict('records')
    else:
        cols = pd.read_sql(f"SELECT column_name as name, data_type as type FROM information_schema.columns WHERE table_name='{args['table']}'", eng).to_dict('records')
    print(json.dumps({"columns": cols, "indexes": []}))

elif 'sql_query' in sys.argv[0]:
    eng = get_engine()
    df = pd.read_sql(args['sql'], eng).head(args.get('limit',1000))
    print(json.dumps({"columns": list(df.columns), "rows": df.values.tolist()}))

elif 'sql_explain' in sys.argv[0]:
    eng = get_engine()
    plan = pd.read_sql(f"EXPLAIN {args['sql']}", eng).to_dict('records')
    print(json.dumps({"plan": plan}))

elif 'sql_insert' in sys.argv[0]:
    eng = get_engine()
    df = pd.DataFrame(args['values'])
    df.to_sql(args['table'], eng, if_exists='append', index=False)
    print(json.dumps({"count": len(df)}))
