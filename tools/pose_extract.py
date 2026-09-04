"""video -> poses 3D (MediaPipe PoseLandmarker, world landmarks en metres) -> npz"""
import sys, time, numpy as np, cv2
import mediapipe as mp
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision
def extract(path, out, stride=1):
    opts = vision.PoseLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_path='pose_landmarker_full.task'),
                                        running_mode=vision.RunningMode.VIDEO, num_poses=1,
                                        min_pose_detection_confidence=0.5, min_tracking_confidence=0.5)
    lm = vision.PoseLandmarker.create_from_options(opts)
    cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS); n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    W = np.full((n, 33, 3), np.nan, np.float32); V = np.zeros((n, 33), np.float32); I = np.full((n, 33, 2), np.nan, np.float32)
    t0 = time.time(); i = 0
    while True:
        ok, frame = cap.read()
        if not ok: break
        if i % stride == 0:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = lm.detect_for_video(img, int(i * 1000 / fps))
            if res.pose_world_landmarks:
                w = res.pose_world_landmarks[0]; p = res.pose_landmarks[0]
                W[i] = [(l.x, l.y, l.z) for l in w]; V[i] = [l.visibility for l in w]; I[i] = [(l.x, l.y) for l in p]
        i += 1
    cap.release()
    got = int((~np.isnan(W[:, 0, 0])).sum())
    np.savez_compressed(out, world=W, vis=V, img=I, fps=fps)
    print(f'{path}: {i} images, {got} poses ({100*got/max(1,i):.0f}%), {time.time()-t0:.0f}s -> {out}')
if __name__ == '__main__':
    for a in sys.argv[1:]:
        p, o = a.split('=')
        extract(p, o)
