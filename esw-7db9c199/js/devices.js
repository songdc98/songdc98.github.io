/* Device and source tables for the lab. Numbers mirror scripts/esworld/agents_cfg.py (devices), rf/radios.py (radio presets) and the acoustics library (source levels at 1 m). */
(function () {
  const ES = window.ES;
  /* kind -> placeable agent. cam: horizontal FOV [deg], resolution, mount height above ground [m] (UAVs use their own altitude). */
  ES.DEVICES = {
    uav: { label: "UAV (Skydio X2 class)", short: "UAV", color: "#cc79a7", tier: "XS", modes: 2, tops: 2.6, z: 28, cam: { hfov: 84, res: [1280, 720], pitch: -55 },
      radios: ["fpv5g8", "ism900"], ego: 92, speed: 5.0, antH: 0, sensors: "Gimbal camera 1280×720 · front camera · LiDAR Mid-360 · barometer · IMU · GNSS · microphone", lidar: { model: "livox_mid360", mount: [0.0, 0, -0.06], rpy: [Math.PI, 0, 0], rate_hz: 10.0 }, battery_wh: 62 },
    dog: { label: "Quadruped robot (Unitree Go2 class)", short: "Quadruped", color: "#d55e00", tier: "S", modes: 8, tops: 100, z: 0.45, cam: { hfov: 100, res: [1280, 720], pitch: 0 },
      radios: ["wifi6", "ism900", "nr_ue"], ego: 78, speed: 1.0, antH: 0.45, sensors: "Front / rear cameras · 4D LiDAR (30 m) · 4-mic array · IMU · GNSS", lidar: { model: "unitree_l1", mount: [0.28, 0, 0.12], rate_hz: 10.0 }, battery_wh: 216 },
    human: { label: "Responder (helmet camera)", short: "Person", color: "#009e73", tier: "S", modes: 8, tops: 40, z: 1.6, cam: { hfov: 90, res: [1280, 720], pitch: 0 },
      radios: ["nr_ue", "wifi6", "ble5"], ego: 42, speed: 1.4, antH: 1.4, sensors: "Helmet camera · binaural microphones · watch", lidar: null, battery_wh: 17 },
    rover: { label: "Delivery robot", short: "Robot", color: "#e69f00", tier: "XS", modes: 2, tops: 8, z: 0.7, cam: { hfov: 110, res: [1280, 720], pitch: 0 },
      radios: ["wifi6", "lte_ue"], ego: 62, speed: 1.4, antH: 0.6, sensors: "Front camera · 16-beam LiDAR · microphone", lidar: { model: "velodyne_vlp16", mount: [0.0, 0, 0.45], rate_hz: 10.0 }, battery_wh: 300 },
    cp: { label: "Command post (mast)", short: "Command post", color: "#0072b2", tier: "L", modes: 32, tops: 700, z: 6.0, cam: { hfov: 110, res: [1920, 1080], pitch: -10 },
      radios: ["nr_gnb", "wifi6", "ism900"], ego: 35, speed: 0, antH: 6.0, sensors: "Mast camera 1920×1080 · microphone · base station" },
  };
  /* targets the user can drop (what the agents look for / listen to) */
  ES.TARGETS = {
    person: { label: "Standing person", short: "Standing", color: "#111111", z: 1.0, h: 1.7, ext: 1.7, spl: 60, snd: "Speech (normal, 60 dB)" },
    lying: { label: "Person on the ground (calling for help)", short: "Casualty", color: "#d62728", z: 0.3, h: 0.4, ext: 1.7, spl: 82, snd: "Calling for help (loud, 82 dB)" },
    vehicle: { label: "Moving vehicle", short: "Vehicle", color: "#555555", z: 0.8, h: 1.5, ext: 4.2, spl: 86, snd: "Passing car (86 dB)" },
  };
  /* sound sources: A-weighted level at 1 m (acoustics library table) */
  ES.SOUNDS = {
    speech_normal: { label: "Normal speech", l1m: 60 }, speech_shout: { label: "Shouting", l1m: 92 }, footsteps: { label: "Footsteps", l1m: 60 },
    quadruped: { label: "Quadruped walking", l1m: 65 }, multicopter: { label: "Multicopter UAV", l1m: 77 }, car: { label: "Car passing", l1m: 86 },
    dog_bark: { label: "Dog barking", l1m: 100 }, car_horn: { label: "Car horn", l1m: 110 }, siren: { label: "Siren", l1m: 115 }, generator: { label: "Generator", l1m: 98 },
    school_bell: { label: "School bell", l1m: 95 }, phone_ring: { label: "Phone ringtone", l1m: 75 },
  };
  /* radio presets: ladders are [SNR dB, rate Mbit/s] (approximate PHY ladders of the Python presets), mac = goodput fraction */
  const NR_EFF = [0.1523, 0.2344, 0.377, 0.6016, 0.877, 1.1758, 1.4766, 1.9141, 2.4063, 2.7305, 3.3223, 3.9023, 4.5234, 5.1152, 5.5547];
  const NR_THR = [-6.7, -4.7, -2.3, 0.2, 2.4, 4.3, 5.9, 8.1, 10.3, 11.7, 14.1, 16.3, 18.7, 21, 22.7];
  const nr = (B) => NR_THR.map((t, i) => [t, (B * NR_EFF[i] * 0.917) / 1e6]);   // 0.917 matches rf.radios (509.5 Mbit/s at CQI 15, 100 MHz)
  const n11 = (rates) => rates.map((r, i) => [[5, 8, 11, 14, 18, 22, 24, 26][i], r]);
  ES.RADIOS = {
    wifi6: { label: "Wi-Fi 6 · 5.8 GHz / 80 MHz", fc: 5.775, B: 80e6, Pt: 23, G: 2.15, NF: 6, mac: 0.65, group: "wifi6",
      ladder: [[5, 36], [8, 72], [11, 108], [14, 144], [18, 216], [22, 288], [24, 324], [26, 360], [30, 432], [32, 480], [35, 540], [37, 600]] },
    nr_gnb: { label: "5G NR n78 base station", fc: 3.5, B: 100e6, Pt: 33, G: 5, NF: 5, mac: 0.9, group: "nr", ladder: nr(100e6) },
    nr_ue: { label: "5G NR n78 terminal", fc: 3.5, B: 100e6, Pt: 23, G: 0, NF: 7, mac: 0.9, group: "nr", ladder: nr(100e6) },
    lte_ue: { label: "LTE B3 terminal", fc: 1.84, B: 20e6, Pt: 23, G: 0, NF: 7, mac: 0.9, group: "lte", ladder: nr(20e6) },
    ism900: { label: "900 MHz Mesh · 10 MHz", fc: 0.915, B: 10e6, Pt: 30, G: 3, NF: 6, mac: 0.65, group: "ism900", ladder: n11([3.25, 6.5, 9.75, 13, 19.5, 26, 29.25, 32.5]) },
    fpv5g8: { label: "Digital video link · 5.8 GHz / 20 MHz", fc: 5.8, B: 20e6, Pt: 27, G: 2, NF: 6, mac: 0.65, group: "fpv", ladder: n11([6.5, 13, 19.5, 26, 39, 52, 58.5, 65]) },
    ble5: { label: "Bluetooth 5 · coded PHY", fc: 2.44, B: 2e6, Pt: 4, G: 0, NF: 7, mac: 0.7, group: "ble", ladder: [[-1, 0.125], [2, 0.5], [7, 1], [11, 2]] },
  };
  ES.PAYLOADS = { state: { label: "State vector 2 KB", bytes: 2048 }, lidar: { label: "LiDAR scan 256 KB", bytes: 262144 }, video: { label: "Video chunk 1 MB", bytes: 1048576 } };
})();
