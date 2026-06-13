# /workers/gkeep.py
import sys, json, gkeepapi
from gkeepapi.node import List, Note

keep = gkeepapi.Keep()
keep.authenticate('your_email@gmail.com', 'app_password') # or use oauth token

args = json.loads(sys.argv[1])
task = sys.argv[0] # passed as first arg

if 'gkeep_create' in task:
    if args['type'] == 'list':
        note = keep.createList(args['title'], [(item, False) for item in args['items']])
    else:
        note = keep.createNote(args['title'], args['text'])

    note.color = getattr(gkeepapi.node.ColorValue, args.get('color', 'White'))
    note.pinned = args.get('pinned', False)

    for label in args.get('labels', []):
        l = keep.findLabel(label)
        if not l: l = keep.createLabel(label)
        note.labels.add(l)

    keep.sync()
    print(json.dumps({"id": note.id, "title": note.title}))

elif 'gkeep_search' in task:
    results = []
    for note in keep.find(query=args['query']):
        results.append({
            "id": note.id,
            "title": note.title,
            "text": note.text,
            "type": "list" if isinstance(note, List) else "note",
            "labels": [l.name for l in note.labels.all()]
        })
    print(json.dumps(results))

elif 'gkeep_list' in task:
    results = []
    for note in keep.all():
        if args.get('project') and args['project'] not in [l.name for l in note.labels.all()]:
            continue
        results.append({
            "id": note.id,
            "title": note.title,
            "pinned": note.pinned,
            "labels": [l.name for l in note.labels.all()]
        })
    print(json.dumps(results))
