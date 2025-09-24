Of course. Here is the comprehensive Product Requirements Document (PRD) summarizing all the requirements for your sales tracking and operations dashboard.

***

## Product Requirements Document: Unified Sales & Operations Dashboard

* **Version:** 3.0
* **Status:** Final
* **Author:** Gemini
* **Date:** 23 September 2025
* **Stakeholders:** Sales Manager, Marketing Lead, Operations Lead, Executive Team

### 1. Introduction & Overview

This document outlines the requirements for a new, centralized **Sales & Operations Dashboard**. The core of this project is to build a modern **data warehouse** that will serve as the single source of truth for all sales and customer data.

This initiative involves a critical data migration, consolidating all historical sales data from our legacy system (**Reckon**) with new, ongoing data from **Xero**. The system will feature a fully automated data pipeline and a powerful, user-friendly dashboard for visualization and analysis. This will provide a seamless, unified view of business performance, empowering data-driven decisions across all departments.

### 2. Problem Statement

As we transition from Reckon to Xero, we face the significant challenge of unifying our sales data. Our historical data in Reckon is a vital asset for trend analysis, but it's currently siloed from the new data being generated in Xero. Without a unified system, critical tasks like year-over-year performance comparisons would be impossible to conduct accurately and efficiently.

Our current reliance on manual reporting is unsustainable. We need an automated system that provides a holistic view of our business performance, allowing stakeholders to analyze trends without needing to worry about the underlying data sources.

### 3. Goals & Objectives

The primary goal is to empower the sales, marketing, operations, and leadership teams with a unified, accurate, and automated view of business performance.

* **Goal 1: Create a Single Source of Truth:** Establish a data warehouse that consolidates all historical sales data from Reckon and all new data from Xero.
* **Goal 2: Fully Automate Reporting:** Eliminate all manual data extraction and reporting by implementing an automated data pipeline from Xero.
* **Goal 3: Provide a Seamless User Experience:** Ensure that end-users can analyze data through a single interface, with no visibility into the underlying complexity of the data sources.
* **Goal 4: Enable Deep, Multi-Dimensional Analysis:** Provide the ability to analyze sales from every critical business angle.
* **Goal 5: Build a Scalable Foundation:** Create a data infrastructure that can support future operational planning and forecasting needs.

### 4. Functional Requirements

#### FR1: Data Warehouse & Ingestion

1.  **Data Warehouse:** A cloud data warehouse (e.g., BigQuery, Snowflake) will be established as the central repository for all business data.
2.  **Historical Data Migration (Reckon):** A one-time process will migrate all historical sales transaction data from Reckon into the data warehouse, mapping it to the new, unified data model.
3.  **Automated Data Synchronization (Xero):** An automated data pipeline will connect to the Xero API, pulling new sales data **daily** to ensure the dashboard is always up-to-date.
4.  **Unified Data Model:** The warehouse will use a single, consistent schema for all sales and customer data, regardless of its origin (Reckon or Xero). This includes fact tables for sales (`fct_sales_line`) and dimension tables (`dim_customer`, `dim_product`).

#### FR2: Data Management & Dimensions

1.  **Editable Dimensions:** The system must allow authorized users to easily **update and amend customer dimension tables**. This includes the ability to modify customer details and re-assign customer clusters as business needs evolve.
2.  **Key Analysis Dimensions:** The data model must be structured to allow for slicing and dicing of sales data by the following key dimensions:
    * **Customer:** Individual customer analysis.
    * **Parent Customer:** Grouped analysis by the parent entity (Merchant Group, e.g., 'Farmlands', 'PGG Wrightson Ltd').
    * **Customer Cluster:** Analysis based on predefined customer groupings.
    * **Product & Product Category:** Analysis of individual product performance and their categories.
    * **Market:** Geographic market analysis, including **Local, Australia, USA,** and any other export markets.

#### FR3: The Dashboard - KPIs & Visualizations

The dashboard will be built using a modern Business Intelligence (BI) tool (e.g., Looker Studio, Power BI, Tableau).

1.  **Global Filters:** The entire dashboard must be filterable by all key dimensions listed in FR2, plus a flexible date range picker.
2.  **Time-Based Comparisons:** The dashboard must provide at-a-glance comparisons of sales performance for the following periods versus the same period in the previous year(s):
    * **Year-to-Date (YTD)**
    * **Month-to-Date (MTD)**
    * **Weekly**
3.  **Key Visualizations:**
    * **Sales Over Time (Line Chart):** Total sales revenue over the selected period with a comparison line for the previous year.
    * **Breakdown Charts (Bar/Pie):** Dynamic charts to view sales revenue by **Market**, **Parent Customer**, **Product Category**, and **Customer Cluster**.
    * **Top Performers Tables:** Tables showing top 10 products, customers, and parent customers by revenue.
    * **Detailed Data View:** A searchable and exportable table of all individual transaction lines for deep-dive analysis.

### 5. Non-Functional Requirements

* **Performance:** The dashboard must load in under 5 seconds. Filters and interactions should update visualizations in under 2 seconds.
* **Reliability:** The automated data pipeline must have monitoring and alerting to ensure data freshness. A clear "Data Last Updated" timestamp will be visible on the dashboard.
* **Usability / Abstraction:** The user experience must be seamless. End-users will interact with a single, unified dashboard and will have **no awareness** of whether the underlying data originated from Reckon or Xero.
* **Security:** Access to the dashboard and underlying data will be restricted to authorized personnel via secure credentials.

### 6. Future Scope & Roadmap 🚀

This project is the foundation for a comprehensive business operations platform. The data warehouse will be designed to support the following future enhancements:

* **Phase 2: Order & Inventory Management**
    * Integrate **forecasted and forward orders** for customers.
    * Implement a mechanism to **convert these orders into actual sales**.
    * Develop a **purchase order planning** module based on sales velocity and forward demand.
* **Phase 3: Financial Planning & Analysis**
    * Integrate **budgeting data** for variance analysis against actuals.
    * Develop a **cashflow forecasting** model by combining sales data, orders, and payables.

### 7. Success Metrics

* **Adoption Rate:** >90% of target users accessing the dashboard weekly within one month of launch.
* **Time Saved:** A significant reduction in time spent on manual reporting, confirmed by stakeholder feedback.
* **Data-Informed Decisions:** At least one strategic business decision per quarter is directly attributed to insights from the dashboard.
* **Data Accuracy:** <1% rate of user-reported data discrepancies against source systems.