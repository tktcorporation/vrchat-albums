#!/bin/bash

# スクリプトがエラーに遭遇した場合に終了し、未定義の変数を参照した場合にも終了
set -eu

# スクリプトのディレクトリを取得
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"

# 縦横のパターンと色の定義を追加
declare -A width_height_patterns=(
    [1280x720]=1
    [1920x1080]=2
    [2560x1440]=3
    # たて長
    [1280x1920]=4
    [1440x2560]=5
)

# 淡いカラフルなパステルカラーパレット
declare -a theme_colors=(
    # パステルピンク系
    "FFE5EC" "FFCCD5" "FFB3BA" "FF99A1" "FF8087"
    # パステルブルー系
    "E6F3FF" "CCE7FF" "B3DBFF" "99CFFF" "80C3FF"
    # パステルグリーン系
    "E6FFE6" "CCFFCC" "B3FFB3" "99FF99" "80FF80"
    # パステルイエロー系
    "FFFAE6" "FFF4CC" "FFEDB3" "FFE799" "FFE080"
    # パステルパープル系
    "F3E6FF" "E7CCFF" "DBB3FF" "CF99FF" "C380FF"
    # パステルオレンジ系
    "FFEDE6" "FFDACC" "FFC7B3" "FFB499" "FFA180"
    # パステルターコイズ系
    "E6FFF9" "CCFFF3" "B3FFEC" "99FFE6" "80FFDF"
)

# テーマに合う色をランダムに選択する関数
generate_theme_color() {
    local array_size=${#theme_colors[@]}
    local random_index=$((RANDOM % array_size))
    echo "${theme_colors[$random_index]}"
}

# ファイル名の生成関数を更新
generate_random_filename() {
    local month_year=$1
    local month=${month_year:5:2}
    local year=${month_year:0:4}
    
    local day=$(printf "%02d" $((RANDOM % 28 + 1)))
    local hour=$(printf "%02d" $((RANDOM % 24)))
    local minute=$(printf "%02d" $((RANDOM % 60)))
    local second=$(printf "%02d" $((RANDOM % 60)))
    local millisecond=$(printf "%03d" $((RANDOM % 1000)))
    
    # ランダムに解像度を選択
    local resolutions=("1280x720" "1920x1080" "2560x1440" "1280x1920" "1440x2560")
    local resolution=${resolutions[$((RANDOM % ${#resolutions[@]}))]}
    
    local filename="./debug/photos/VRChat/${month_year}/VRChat_${year}-${month}-${day}_${hour}-${minute}-${second}.${millisecond}_${resolution}.png"
    local dimensions=(${resolution//x/ })
    local width=${dimensions[0]}
    local height=${dimensions[1]}
    
    echo "${filename}|${width}|${height}"
}

# 月ごとの枚数の定義は変更なし
declare -A month_counts=(
    ["2023-01"]=3
    ["2023-02"]=4
    ["2023-03"]=6
    ["2023-04"]=10
    ["2023-05"]=9
    ["2023-06"]=23
    ["2023-07"]=9
    ["2023-08"]=5
    ["2023-09"]=10
    ["2023-10"]=7
    ["2023-11"]=20
    ["2023-12"]=3
    ["2024-02"]=12
    ["2025-01"]=3
)

# ファイルの生成処理を更新
for month_year in "${!month_counts[@]}"; do
    count=${month_counts[$month_year]}
    echo "処理中の月: $month_year, 枚数: $count"
    
    for ((i=0; i<count; i++)); do
        IFS='|' read -r dest_file width height <<< "$(generate_random_filename $month_year)"
        
        if [ ! -f "$dest_file" ]; then
            mkdir -p "$(dirname "$dest_file")"
            
            # テーマに合う背景色とテキスト色を生成
            # 背景色と前景色のペアを定義して、見やすい組み合わせを保証
            bg_color=$(generate_theme_color)
            
            # パステルカラーには濃いめのグレーまたは白を使用
            # ランダムに選択（全て明るい背景なので）
            if [ $((RANDOM % 2)) -eq 0 ]; then
                text_color="4A5568"  # ミディアムグレー（読みやすい）
            else
                text_color="FFFFFF"  # 白（パステルカラーに映える）
            fi
            
            # placehold.jpを使用して画像を生成（小さめのフォントサイズを指定）
            # 画像サイズに応じてフォントサイズを調整
            if [ $width -le 1280 ]; then
                font_size=54
            elif [ $width -le 1920 ]; then
                font_size=72
            else
                font_size=96
            fi
            
            # プレースホルダーテキストも小さめに
            # placehold.jpのAPIは 背景色/文字色 の順序
            # CSSパラメータはURLエンコードされたJSON形式で渡す
            css_json="{\"font-size\":\"${font_size}px\"}"
            css_encoded=$(echo -n "$css_json" | jq -sRr @uri)
            curl -s "https://placehold.jp/${bg_color}/${text_color}/${width}x${height}.png?text=${width}x${height}&css=${css_encoded}" -o "$dest_file"
            echo "作成完了: $dest_file (${width}x${height})"
        else
            echo "既に存在します: $dest_file, スキップします"
        fi
    done
done
