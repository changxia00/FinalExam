# FinalExam
FinalExam

erDiagram
    %% 定義地理位置維度表 (來自 data2.csv)
    GEOGRAPHIC_LOCATION {
        string alpha_3_code PK "主鍵: ISO 3位代碼 (對應 data1 的 Code)"
        string country_name "國家名稱 (name)"
        string alpha_2_code "2位代碼"
        int numeric_code "數字代碼"
        string iso_3166_2 "ISO 3166-2 格式"
        string region "洲/大區 (如 Asia)"
        string sub_region "子區域 (如 Southern Asia)"
        string intermediate_region "中間區域"
        int region_code "區域代碼"
    }

    %% 定義收入數據事實表 (來自 data1.csv)
    INCOME_DATA {
        int year PK "年份 (複合主鍵的一部分)"
        string country_code FK "外鍵: 對應 GEOGRAPHIC_LOCATION"
        string entity_name "實體名稱 (如 Afghanistan)"
        float richest_income_share "最富有人群收入份額 (%)"
    }

    %% 定義關係
    GEOGRAPHIC_LOCATION ||--o{ INCOME_DATA : "has_records_for (擁有多年的數據)"
