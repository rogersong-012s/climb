# 登峰灶急

一頁式節奏判定 × QTE × 隨機怪物登頂遊戲。使用原生 HTML、CSS 與 JavaScript ES Modules，無框架、無後端；可直接發布到 GitHub Pages。

## 本機執行

需要 Node.js 18 或更新版本。

    npm start

接著在瀏覽器開啟 http://localhost:8001。ES Modules 需要透過 HTTP 或 HTTPS 載入，不要用 file:// 開啟。

## 測試

    npm test

測試使用 Node.js 內建的 node:test，沒有額外套件。

## 檔案結構

    index.html
    styles/main.css
    js/
      config.js       遊戲數值、怪物事件樓層區間及 UI 文案
      combo.js        COMBO 爬升量與判定區計算
      events.js       怪物事件排程與跨樓層觸發
      monsters.js     怪物、解法、擊退及 DEBUFF 資料
      qte.js          亂序字母盤、多解法前綴判定與重置
      effects.js      DEBUFF 生命週期及解法效果
      climbing.js     命中、MISS、攀登與擊退狀態更新
      game.js         遊戲狀態機、節奏、計時與事件協調
      ui.js           DOM 呈現與輸入元件
      main.js         瀏覽器事件及 requestAnimationFrame 迴圈
    scripts/serve.mjs 本機靜態 HTTP 伺服器
    tests/systems.test.js

GitHub Pages 從 repository root 發布即可。CSS、JavaScript 使用相對路徑，適用於專案子路徑。遊戲圖形是頁面內建 SVG 與 CSS，不依賴外部圖檔。
