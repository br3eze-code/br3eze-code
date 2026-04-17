# /workers/data.py
import sys, json, pandas as pd, numpy as np
import matplotlib.pyplot as plt, seaborn as sns
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor
from sklearn.cluster import KMeans
from sklearn.metrics import r2_score
args = json.loads(sys.argv[1])

def load_df():
    f = args['file']
    if f.endswith('.csv'): df = pd.read_csv(f, nrows=args.get('limit',1000))
    elif f.endswith('.xlsx'): df = pd.read_excel(f, nrows=args.get('limit',1000))
    elif f.endswith('.parquet'): df = pd.read_parquet(f)
    return df

if 'df_load' in sys.argv[0]:
    df = load_df()
    print(json.dumps({
      "rows": len(df), "cols": list(df.columns),
      "dtypes": {c:str(t) for c,t in df.dtypes.items()},
      "head": df.head().to_dict('records')
    }))

elif 'df_stats' in sys.argv[0]:
    df = load_df()
    desc = df.describe().round(3).to_dict()
    miss = df.isna().sum().to_dict()
    print(json.dumps({"describe":desc,"missing":miss}))

elif 'df_corr' in sys.argv[0]:
    df = load_df().select_dtypes('number')
    corr = df.corr().round(3)
    plt.figure(figsize=(8,6)); sns.heatmap(corr, annot=True, cmap='coolwarm');
    path = f"/mnt/data/corr_{abs(hash(args['file']))}.png"
    plt.savefig(path); plt.close()
    print(json.dumps({"matrix":corr.to_dict(),"heatmap":path}))

elif 'df_plot' in sys.argv[0]:
    df = load_df()
    plt.figure(figsize=(8,5))
    if args['kind']=='scatter': sns.scatterplot(data=df, x=args['x'], y=args['y'], hue=args.get('group_by'))
    elif args['kind']=='line': sns.lineplot(data=df, x=args['x'], y=args['y'], hue=args.get('group_by'))
    elif args['kind']=='hist': sns.histplot(data=df, x=args['x'], hue=args.get('group_by'))
    elif args['kind']=='box': sns.boxplot(data=df, x=args['group_by'], y=args['y'])
    path = f"/mnt/data/plot_{abs(hash(str(args)))}.png"
    plt.tight_layout(); plt.savefig(path); plt.close()
    print(json.dumps({"png":path}))

elif 'df_regress' in sys.argv[0]:
    df = load_df()[[args['x'],args['y']]].dropna()
    X, y = df[[args['x']]], df[args['y']]
    if args['model']=='linear': model = LinearRegression()
    else: model = RandomForestRegressor()
    model.fit(X,y); y_pred = model.predict(X); r2 = r2_score(y,y_pred)
    coef = model.coef_.tolist() if hasattr(model,'coef_') else []
    eq = f"{args['y']} = {coef[0]:.3f}*{args['x']} + {model.intercept_:.3f}" if coef else "non-linear"
    plt.figure(); plt.scatter(X,y,alpha=0.5); plt.plot(X,y_pred,c='r');
    path = f"/mnt/data/reg_{abs(hash(str(args)))}.png"; plt.savefig(path); plt.close()
    print(json.dumps({"r2":round(r2,3),"coef":coef,"eq":eq,"plot":path}))

elif 'df_cluster' in sys.argv[0]:
    df = load_df()[[args['x'],args['y']]].dropna()
    km = KMeans(n_clusters=args['n_clusters']).fit(df)
    plt.figure(); sns.scatterplot(x=df[args['x']], y=df[args['y']], hue=km.labels_, palette='tab10')
    plt.scatter(km.cluster_centers_[:,0], km.cluster_centers_[:,1], c='k', marker='x', s=200)
    path = f"/mnt/data/clust_{abs(hash(str(args)))}.png"; plt.savefig(path); plt.close()
    print(json.dumps({"labels":km.labels_.tolist(),"centers":km.cluster_centers_.tolist(),"plot":path}))

elif 'df_to_json' in sys.argv[0]:
    df = load_df()
    print(json.dumps({"cols":list(df.columns),"rows":df.values.tolist()}))
