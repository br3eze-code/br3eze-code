# /agents/pcb.py
import sys, json, subprocess, os
from pathlib import Path
from skidl import *
args = json.loads(sys.argv[1])

def run_kicad(cmd): return subprocess.run(['kicad-cli'] + cmd, check=True, capture_output=True, text=True)

if 'netlist_gen' in sys.argv[0]:
    for p in args['parts']: Part(p['value'], p['ref'], footprint=p['footprint'])
    for n in args['netlist']: Net(n['net']).connect(*[eval(p) for p in n['pads']])
    generate_netlist(file_=args['output'])
    print(json.dumps({"netlist": args['output']}))

elif 'sch_gen' in sys.argv[0]:
    proj = Path(args['proj_dir']); proj.mkdir(exist_ok=True)
    sch = proj / f"{args['project']}.kicad_sch"
    run_kicad(['sch', 'new', str(sch)])
    run_kicad(['sch', 'update', str(sch), '--netlist', args['netlist']])
    run_kicad(['sch', 'export', 'pdf', str(sch), '-o', str(sch.with_suffix('.pdf'))])
    print(json.dumps({"sch": str(sch), "pdf": str(sch.with_suffix('.pdf'))}))

elif 'pcb_layout' in sys.argv[0]:
    proj = Path(args['proj_dir'])
    pcb = proj / f"{args['project']}.kicad_pcb"
    run_kicad(['pcb', 'new', str(pcb)])
    run_kicad(['pcb', 'update', str(pcb), '--netlist', str(proj / f"{args['project']}.net")])
    if args['placement']=='auto': run_kicad(['pcb', 'place', str(pcb), '--auto'])
    run_kicad(['pcb', 'export', 'png', str(pcb), '-o', str(pcb.with_suffix('.png'))])
    print(json.dumps({"pcb": str(pcb), "png": str(pcb.with_suffix('.png'))}))

elif 'pcb_route' in sys.argv[0]:
    pcb = Path(args['proj_dir']) / f"{Path(args['proj_dir']).name}.kicad_pcb"
    run_kicad(['pcb', 'export', 'dsn', str(pcb)])
    subprocess.run(['java','-jar','/opt/freerouting.jar','-de',str(pcb.with_suffix('.dsn')),'-do',str(pcb.with_suffix('.ses'))])
    run_kicad(['pcb', 'import', 'ses', str(pcb), '--file', str(pcb.with_suffix('.ses'))])
    drc = run_kicad(['pcb', 'drc', str(pcb)]).stdout
    unrouted = drc.count('Unrouted')
    print(json.dumps({"pcb": str(pcb), "drc": drc.split('\n')[-20:], "unrouted": unrouted}))

elif 'pcb_gerber' in sys.argv[0]:
    pcb = Path(args['proj_dir']) / f"{Path(args['proj_dir']).name}.kicad_pcb"
    out = Path(args['proj_dir']) / 'fab'
    out.mkdir(exist_ok=True)
    run_kicad(['pcb', 'export', 'gerbers', str(pcb), '-o', str(out)])
    run_kicad(['pcb', 'export', 'drill', str(pcb), '-o', str(out)])
    run_kicad(['sch', 'export', 'bom', str(pcb.with_suffix('.kicad_sch')), '-o', str(out / 'bom.csv')])
    run_kicad(['pcb', 'export', 'pos', str(pcb), '-o', str(out / 'pos.csv')])
    subprocess.run(['zip','-j', str(out.with_suffix('.zip')), *out.glob('*')])
    print(json.dumps({"zip": str(out.with_suffix('.zip')), "bom": str(out/'bom.csv'), "pos": str(out/'pos.csv')}))
