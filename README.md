# EnergyPulse 2.0

Web-based energy analytics for commercial buildings: consumption analysis, machine-learning
forecasting, peak-load classification, feature importance and alerts.

## Run
Backend:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows  (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Frontend (new terminal):
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173

## What the system does (maps to the study objectives)
| Objective | Where |
|---|---|
| 1. Consumption patterns and statistics | `GET /api/datasets/{file}/analytics`, Overview / Energy Consumption pages |
| 2. Compare models, forecast, alerts | `GET /api/datasets/{file}/ml`, Forecasting page |
| 3. Peak-load classification | same endpoint (`classification`), Peak-Load & Energy Planning page |
| 4. Key influencing features | same endpoint (`feature_importance`), Forecasting page |
| 5. Evaluation metrics | MAE / RMSE / MAPE / R² and accuracy / precision / recall / F1 are computed on a held-out test set |

## Machine-learning method (`backend/app/services/ml_service.py`)
- **Split:** chronological. The last 90 days are held out for testing; models never see them while training.
- **Models compared:** Seasonal Naive (same hour last week, baseline), Linear Regression, Random Forest, Gradient Boosting. The lowest-RMSE ML model is selected and refit on all data.
- **Inputs:** hour, day of week, month, weekend, holiday flag, outdoor temperature, humidity, usage one week earlier. Values that are unknown at forecast time (e.g. occupancy) are intentionally not used.
- **Forecast:** next 168 hours. Future weather uses the historical average for that month and hour.
- **Peak-load classes:** Off-Peak <= 40th percentile < Standard <= 85th percentile < Peak-Load. Thresholds come from training data only and can be changed with `?low_pct=` and `?high_pct=`.
- **Feature importance:** permutation importance on the test set.
- **Alerts:** consecutive forecast hours predicted as Peak-Load are grouped into alert windows.

## CSV format
Hourly data (one row per hour), at least ~6 months for the ML analysis:
- a timestamp column (`timestamp`, `datetime`, `date`, ...)
- an energy column (`total_building_energy_kwh`, `electricity_kwh`, `energy_kwh`, `kwh`, ...)
- optional: `outdoor_temperature_c`, `relative_humidity_pct`, `is_holiday`, `*_kwh` equipment columns, `total_building_demand_kw`

## Notes
- The bundled dataset is **synthetic** (`data_status = SYNTHETIC_SIMULATED`, fictional building). State this as a limitation in the paper.
- Cost uses an editable PHP/kWh rate; it is not an official Meralco bill.
- User acceptability (objective 5) is measured with a questionnaire, outside the software.
