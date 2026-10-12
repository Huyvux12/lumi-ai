set -eu
cd /opt/lumi
test -f .env
test -f .env.backend
git fetch --depth 1 origin +main:refs/remotes/origin/main
git checkout -f -B main refs/remotes/origin/main
test -f .env
test -f .env.backend
sudo docker compose up -d --build
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8000/health || true)
  web=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3000/ || true)
  if [ "$code" = "200" ] && { [ "$web" = "200" ] || [ "$web" = "307" ]; }; then
    ok=1
    break
  fi
  sleep 5
done
if [ "$ok" != "1" ]; then
  sudo docker compose ps
  sudo docker logs lumi-backend-1 --tail 40
  exit 1
fi
echo DEPLOY_OK
