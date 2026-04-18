#!/usr/bin/env bash
# 修复：nginx(www-data) 读取用户家目录下 frontend/dist 时的 Permission denied（常见 500）。
#
# 原因：家目录常为 750 (drwxr-x---)，其他用户无法进入 /home/用户名。
# 做法 A（最小改动）：仅给「其他用户」加上家目录的执行位（可沿已知路径进入子目录，不能列目录）。
#   sudo ./deploy/fix_nginx_dist_permissions.sh
#
# 做法 B（更常见生产）：把 dist 拷到 /var/www，nginx root 指过去（脚本末尾有示例命令）。

set -euo pipefail

USER_HOME="${USER_HOME:-$HOME}"
if [[ ! -d "$USER_HOME" ]]; then
  echo "FATAL: USER_HOME 无效: $USER_HOME" >&2
  exit 1
fi

echo "将对以下目录增加 o+x（需 sudo），以便 www-data 能穿越到家目录下的项目："
echo "  $USER_HOME"
echo ""
if [[ "${SKIP_CHMOD_HOME:-}" == "1" ]]; then
  echo "已设置 SKIP_CHMOD_HOME=1，跳过 chmod。"
else
  sudo chmod o+x "$USER_HOME"
  echo "已执行: sudo chmod o+x $USER_HOME"
fi

DIST="${DIST:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../frontend/dist" 2>/dev/null && pwd)}"
if [[ -d "$DIST" ]]; then
  # dist 内文件需对他人可读（若曾为 660 会读失败）
  sudo chmod -R o+rX "$DIST" 2>/dev/null || chmod -R o+rX "$DIST"
  echo "已放宽 dist 读取: $DIST"
fi

echo ""
echo "请重载 nginx: sudo nginx -t && sudo systemctl reload nginx"
echo "验证: curl -sS -I http://127.0.0.1:3001/ | head -5"
echo ""
echo "--- 做法 B 示例（可选）---"
echo "  sudo mkdir -p /var/www/datainfra"
echo "  sudo rsync -a --delete \"$(dirname "$DIST")/dist/\" /var/www/datainfra/"
echo "  sudo chown -R www-data:www-data /var/www/datainfra"
echo "  然后把 nginx 里 root 改为 /var/www/datainfra"
