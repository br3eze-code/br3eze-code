# /workers/dyno.py
import serial, time, json, sys, csv, io
args = json.loads(sys.argv[1])

if 'dyno_pull' in sys.argv[0]:
    # 1. Connect to Dynojet WinPEP via COM
    dyno = serial.Serial('/dev/ttyUSB0', 9600, timeout=1)
    dyno.write(b'START\n') # Start pull
    time.sleep(1)
    dyno.write(f"GEAR {args['gear']}\n".encode())
    dyno.write(f"RPM_START {args['rpm_start']}\n".encode())

    # 2. Read live data until RPM_END
    data = []
    while True:
        line = dyno.readline().decode().strip() # "4500,320,305,12.1,14.2"
        if not line: continue
        rpm,tq,hp,afr,boost = map(float, line.split(','))
        data.append([rpm,tq,hp,afr,boost])
        if rpm >= args['rpm_end']: break

    dyno.write(b'STOP\n')
    peak = max(data, key=lambda x:x[2]) # peak HP
    csv_out = 'RPM,Torque,HP,AFR,Boost\n' + '\n'.join([','.join(map(str,d)) for d in data])

    print(json.dumps({
      "csv": csv_out,
      "peak_hp": peak[2], "peak_tq": peak[1], "peak_rpm": peak[0],
      "min_afr": min(d[3] for d in data), "max_afr": max(d[3] for d in data),
      "max_boost": max(d[4] for d in data)
    }))

elif 'ecu_flash' in sys.argv[0]:
    # Flash MoTeC M1 via M1 Tune
    import subprocess
    cmd = ['M1Tune.exe','/flash',args['map_file'],'/timing',str(args['changes']['timing']),
           '/fuel',str(args['changes']['fuel']),'/boost',str(args['changes']['boost'])]
    res = subprocess.run(cmd, capture_output=True)
    print(json.dumps({"success": res.returncode==0}))
