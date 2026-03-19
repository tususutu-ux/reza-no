#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "🃏 ============================="
echo "   レザーノ - UNO風カードゲーム"
echo "   ============================="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js がインストールされていません"
  echo "   https://nodejs.org からインストールしてください"
  echo ""
  read -p "Enterキーで閉じる..."
  exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 パッケージをインストール中..."
  npm install
  echo ""
fi

echo "🚀 サーバー起動中..."
echo ""
echo "════════════════════════════════════"
echo "  ブラウザで開いてね 👇"
echo "  http://localhost:3000"
echo "════════════════════════════════════"
echo ""
echo "  止めるときは Ctrl+C"
echo ""

# Open browser automatically
open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null &

node server.js
