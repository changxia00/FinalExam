-- 建立資料庫
CREATE DATABASE IF NOT EXISTS global_economy;
USE global_economy;

-- 1. 建立正規化表格 (3NF)
CREATE TABLE IF NOT EXISTS regions (
    region_code INT PRIMARY KEY,
    name VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS sub_regions (
    sub_region_code INT PRIMARY KEY,
    name VARCHAR(100),
    region_code INT,
    FOREIGN KEY (region_code) REFERENCES regions(region_code)
);

CREATE TABLE IF NOT EXISTS intermediate_regions (
    intermediate_region_code INT PRIMARY KEY,
    name VARCHAR(100),
    sub_region_code INT,
    FOREIGN KEY (sub_region_code) REFERENCES sub_regions(sub_region_code)
);

CREATE TABLE IF NOT EXISTS countries (
    alpha_3 CHAR(3) PRIMARY KEY,
    name VARCHAR(100),
    alpha_2 CHAR(2),
    country_code INT,
    iso_3166_2 VARCHAR(20),
    sub_region_code INT,
    intermediate_region_code INT,
    FOREIGN KEY (sub_region_code) REFERENCES sub_regions(sub_region_code),
    FOREIGN KEY (intermediate_region_code) REFERENCES intermediate_regions(intermediate_region_code)
);

CREATE TABLE IF NOT EXISTS income_statistics (
    stat_id INT AUTO_INCREMENT PRIMARY KEY,
    country_code CHAR(3),
    year INT,
    richest_income_share DECIMAL(10, 4),
    FOREIGN KEY (country_code) REFERENCES countries(alpha_3)
);

-- 2. 建立暫存表以載入 CSV (ETL Process)
CREATE TABLE temp_country_metadata (
    name VARCHAR(255),
    alpha_2 VARCHAR(10),
    alpha_3 VARCHAR(10),
    country_code VARCHAR(10),
    iso_3166_2 VARCHAR(20),
    region VARCHAR(100),
    sub_region VARCHAR(100),
    intermediate_region VARCHAR(100),
    region_code VARCHAR(10),
    sub_region_code VARCHAR(10),
    intermediate_region_code VARCHAR(10)
);

CREATE TABLE temp_income_stats (
    entity VARCHAR(255),
    code VARCHAR(10),
    year INT,
    richest_income_share DECIMAL(10, 4)
);

-- 注意：實際的 LOAD DATA 動作通常需要在 Server 端執行，
-- 這裡我們僅建立結構。實際資料匯入我會建議在 server.js 啟動時執行，
-- 或者使用 Docker 的 volume mapping 讓 mysql 自動執行 (但 CSV 路徑權限較麻煩)。
-- 為求穩定，我們將在 Node.js 啟動時透過 SQL 指令匯入資料。