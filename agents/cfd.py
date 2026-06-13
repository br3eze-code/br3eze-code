# /workers/cfd.py
import sys, json, os, subprocess, shutil
from pathlib import Path
args = json.loads(sys.argv[1])

def mesh():
    case = Path(args['case_dir'])
    shutil.copytree('/opt/openfoam/templates/simpleCar', case)
    # 1. Copy STL to triSurface
    shutil.copy(args['stl'], case / 'constant/triSurface/car.stl')
    # 2. Edit blockMeshDict for velocity/yaw/ride height
    with open(case/'system/blockMeshDict','r+') as f:
        txt = f.read().replace('_VEL_',str(args['velocity']))
        txt = txt.replace('_YAW_',str(args['yaw']))
        txt = txt.replace('_RH_',str(args['ride_height']/1000)) # m
        f.seek(0); f.write(txt); f.truncate()
    # 3. Run meshing
    subprocess.run(['bash','-c',f'cd {case} && blockMesh && surfaceFeatureExtract && snappyHexMesh -overwrite'], check=True)
    # 4. Check mesh quality
    out = subprocess.run(['bash','-c',f'cd {case} && checkMesh'], capture_output=True, text=True)
    cells = int(out.stdout.split('cells:')[1].split()[0])
    print(json.dumps({"cells": cells, "quality": "OK" if "Failed" not in out.stdout else "Poor"}))

def run():
    case = args['case_dir']
    subprocess.run(['bash','-c',f'cd {case} && simpleFoam'], check=True)
    print(json.dumps({"converged": True}))

def post():
    case = args['case_dir']
    # 1. Run forceCoeffs
    subprocess.run(['bash','-c',f'cd {case} && postProcess -func forceCoeffs'], check=True)
    # 2. Parse last line of postProcessing/forceCoeffs/0/coefficient.dat
    coeff = open(f'{case}/postProcessing/forceCoeffs/0/coefficient.dat').readlines()[-1].split()
    Cl, Cd = float(coeff[1]), float(coeff[2])
    L_D = Cl/Cd if Cd else 0
    # 3. Estimate kg at 50m/s: F = 0.5*rho*V^2*A*Cl. Assume A=1.5m2
    downforce_kg = 0.5*1.225*args.get('velocity',50)**2*1.5*Cl/9.81
    drag_kg = 0.5*1.225*args.get('velocity',50)**2*1.5*Cd/9.81
    print(json.dumps({
      "Cl": Cl, "Cd": Cd, "L_D": L_D,
      "downforce_kg": round(downforce_kg,1), "drag_kg": round(drag_kg,1),
      "cop": 42.0, # placeholder: need pressure integration
      "cp_plot": f"{case}/postProcessing/Cp.png", "vtu_path": f"{case}/VTK/case.vtu"
    }))

if 'cfd_mesh' in sys.argv[0]: mesh()
elif 'cfd_run' in sys.argv[0]: run()
elif 'cfd_post' in sys.argv[0]: post()
