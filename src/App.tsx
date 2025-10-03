import React, { useState, useMemo, type ChangeEvent } from "react";
import Plotly from "plotly.js-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { type PlotData } from "plotly.js-dist-min";
import "./App.css";

const Plot = createPlotlyComponent(Plotly);

interface ICurrencyData {
  movingAverages: number[];
  normalizedPrices: number[];
  cumulativeMeans: number[];
}

interface IVisualData {
  [coinName: string]: ICurrencyData | number[];
  avgMaSpread: number[];
}

interface IVisibility {
  movingAverages: boolean;
  normalizedPrices: boolean;
  cumulativeMeans: boolean;
  avgMaSpread: boolean;
}

interface ICoinColors {
  movingAverages: string;
  normalizedPrices: string;
  cumulativeMeans: string;
}

interface IColors {
  [coinName: string]: ICoinColors | string;
  avgMaSpread: string;
}

type TDataType = keyof Omit<IVisibility, "avgMaSpread">;

const CryptoChartViewer: React.FC = () => {
  const [data, setData] = useState<IVisualData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [decimation, setDecimation] = useState<number>(100);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const [visibility, setVisibility] = useState<IVisibility>({
    movingAverages: true,
    normalizedPrices: false,
    cumulativeMeans: false,
    avgMaSpread: true,
  });

  const [colors, setColors] = useState<IColors>({
    DOT: {
      movingAverages: "#8B5CF6",
      normalizedPrices: "#A78BFA",
      cumulativeMeans: "#C4B5FD",
    },
    LINK: {
      movingAverages: "#06B6D4",
      normalizedPrices: "#67E8F9",
      cumulativeMeans: "#A5F3FC",
    },
    avgMaSpread: "#F59E0B",
  });

  const loadFile = async (file: File): Promise<void> => {
    setLoading(true);
    setProgress(0);
    setError(null);

    try {
      const reader = new FileReader();

      reader.onprogress = (e: ProgressEvent<FileReader>) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          setProgress(Math.round(percent));
        }
      };

      reader.onload = async (e: ProgressEvent<FileReader>) => {
        try {
          setProgress(95);
          const result = e.target?.result;
          if (typeof result === "string") {
            const jsonData: IVisualData = JSON.parse(result);
            setData(jsonData);

            const coins = Object.keys(jsonData).filter(
              (k) => k !== "avgMaSpread"
            );
            const defaultColors = [
              "#8B5CF6",
              "#06B6D4",
              "#10B981",
              "#F59E0B",
              "#EF4444",
            ];

            const newColors: IColors = { ...colors };
            coins.forEach((coin, idx) => {
              if (!newColors[coin]) {
                const baseColor = defaultColors[idx % defaultColors.length];
                newColors[coin] = {
                  movingAverages: baseColor,
                  normalizedPrices: baseColor + "CC",
                  cumulativeMeans: baseColor + "88",
                };
              }
            });
            setColors(newColors);
          }
          setProgress(100);
          setTimeout(() => setLoading(false), 500);
        } catch (err) {
          setError("Ошибка парсинга JSON: " + (err as Error).message);
          setLoading(false);
        }
      };

      reader.onerror = () => {
        setError("Ошибка чтения файла");
        setLoading(false);
      };

      reader.readAsText(file);
    } catch (err) {
      setError("Ошибка загрузки: " + (err as Error).message);
      setLoading(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) {
      loadFile(file);
    }
  };

  const decimateArray = (arr: number[], factor: number): number[] => {
    if (!arr || arr.length === 0) return [];
    const result: number[] = [];
    for (let i = 0; i < arr.length; i += factor) {
      result.push(arr[i]);
    }
    return result;
  };

  const plotData = useMemo((): Partial<PlotData>[] => {
    if (!data) return [];

    const traces: Partial<PlotData>[] = [];
    const coins = Object.keys(data).filter((k) => k !== "avgMaSpread");

    coins.forEach((coin) => {
      const coinData = data[coin] as ICurrencyData;

      (Object.keys(visibility) as Array<keyof IVisibility>).forEach(
        (dataType) => {
          if (dataType === "avgMaSpread") return;

          if (visibility[dataType] && coinData[dataType as TDataType]) {
            const arrayData = coinData[dataType as TDataType] as number[];
            const decimatedData = decimateArray(arrayData, decimation);
            const xValues = decimatedData.map((_, i) => i * decimation);

            traces.push({
              x: xValues,
              y: decimatedData,
              type: "scatter",
              mode: "lines",
              name: `${coin} - ${dataType}`,
              line: {
                color:
                  (colors[coin] as ICoinColors)?.[dataType as TDataType] ||
                  "#888",
                width: 2,
              },
              hovertemplate: `${coin} ${dataType}<br>Index: %{x}<br>Value: %{y:.8f}<extra></extra>`,
            });
          }
        }
      );
    });

    if (visibility.avgMaSpread && data.avgMaSpread) {
      const decimatedSpread = decimateArray(
        data.avgMaSpread as number[],
        decimation
      );
      const xValues = decimatedSpread.map((_, i) => i * decimation);

      traces.push({
        x: xValues,
        y: decimatedSpread,
        type: "scatter",
        mode: "lines",
        name: "MA Spread",
        line: { color: colors.avgMaSpread, width: 2 },
        yaxis: "y2",
        hovertemplate: `MA Spread<br>Index: %{x}<br>Value: %{y:.8e}<extra></extra>`,
      });
    }

    return traces;
  }, [data, visibility, colors, decimation]);

  const toggleVisibility = (key: keyof IVisibility): void => {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const updateColor = (
    coin: string,
    dataType: TDataType,
    color: string
  ): void => {
    setColors((prev) => ({
      ...prev,
      [coin]: { ...(prev[coin] as ICoinColors), [dataType]: color },
    }));
  };

  const updateSpreadColor = (color: string): void => {
    setColors((prev) => ({ ...prev, avgMaSpread: color }));
  };

  const coins = data
    ? Object.keys(data).filter((k) => k !== "avgMaSpread")
    : [];

  return (
    <div className="crypto-chart">
      <div className="crypto-chart__container">
        <h1 className="crypto-chart__title">📊 Crypto Visual Data Analyzer</h1>

        <div className="crypto-chart__upload">
          <label className="crypto-chart__upload-label">
            📁 Загрузить .visual.json файл
            <input
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="crypto-chart__upload-input"
            />
          </label>
          <div className="crypto-chart__upload-hint">
            Поддержка файлов до 500 MB
          </div>
        </div>

        {loading && (
          <div className="crypto-chart__loader">
            <div className="crypto-chart__loader-spinner" />
            <div className="crypto-chart__loader-progress">{progress}%</div>
            <div className="crypto-chart__loader-text">
              Загрузка и обработка данных...
            </div>
            <div className="crypto-chart__loader-bar">
              <div
                className="crypto-chart__loader-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && <div className="crypto-chart__error">⚠️ {error}</div>}

        {data && !loading && (
          <>
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className={`crypto-chart__settings-toggle ${
                settingsOpen
                  ? "crypto-chart__settings-toggle--open"
                  : "crypto-chart__settings-toggle--closed"
              }`}
            >
              <span>⚙️ Настройки графика</span>
              <span
                className={`crypto-chart__settings-toggle-arrow ${
                  settingsOpen
                    ? "crypto-chart__settings-toggle-arrow--open"
                    : "crypto-chart__settings-toggle-arrow--closed"
                }`}
              >
                ▼
              </span>
            </button>

            {settingsOpen && (
              <div className="crypto-chart__settings">
                <div className="crypto-chart__settings-card">
                  <label className="crypto-chart__decimation-label">
                    🎯 Прореживание данных: каждая {decimation}-я точка
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="500"
                    value={decimation}
                    onChange={(e) => setDecimation(Number(e.target.value))}
                    className="crypto-chart__decimation-slider"
                  />
                  <div className="crypto-chart__decimation-hint">
                    Чем больше - тем быстрее, но менее детально
                  </div>
                </div>

                <div className="crypto-chart__settings-card">
                  <div className="crypto-chart__settings-card-title">
                    👁️ Показывать данные:
                  </div>
                  {(Object.keys(visibility) as Array<keyof IVisibility>).map(
                    (key) => (
                      <label
                        key={key}
                        className="crypto-chart__visibility-item"
                      >
                        <input
                          type="checkbox"
                          checked={visibility[key]}
                          onChange={() => toggleVisibility(key)}
                          className="crypto-chart__visibility-checkbox"
                        />
                        {key}
                      </label>
                    )
                  )}
                </div>

                {coins.map((coin) => (
                  <div key={coin} className="crypto-chart__settings-card">
                    <div className="crypto-chart__settings-card-title">
                      🎨 Цвета {coin}:
                    </div>
                    {(
                      Object.keys(
                        (colors[coin] as ICoinColors) || {}
                      ) as TDataType[]
                    ).map((dataType) => (
                      <label
                        key={dataType}
                        className="crypto-chart__color-item"
                      >
                        <span className="crypto-chart__color-label">
                          {dataType}:
                        </span>
                        <input
                          type="color"
                          value={(colors[coin] as ICoinColors)[dataType]}
                          onChange={(e) =>
                            updateColor(coin, dataType, e.target.value)
                          }
                          className="crypto-chart__color-picker"
                        />
                      </label>
                    ))}
                  </div>
                ))}

                <div className="crypto-chart__settings-card">
                  <div className="crypto-chart__settings-card-title">
                    🎨 Цвет Spread:
                  </div>
                  <label className="crypto-chart__color-item">
                    <span className="crypto-chart__color-label">
                      avgMaSpread:
                    </span>
                    <input
                      type="color"
                      value={colors.avgMaSpread}
                      onChange={(e) => updateSpreadColor(e.target.value)}
                      className="crypto-chart__color-picker"
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="crypto-chart__chart-wrapper">
              <Plot
                data={plotData}
                layout={{
                  autosize: true,
                  height: 700,
                  title: {
                    text: `📈 Визуализация данных (1 минута таймфрейм)`,
                    font: { size: 20, color: "#1f2937" },
                  } as any,
                  xaxis: {
                    title: { text: "Индекс (минуты)" } as any,
                    gridcolor: "#f3f4f6",
                    showgrid: true,
                  },
                  yaxis: {
                    title: { text: "Значение" } as any,
                    gridcolor: "#f3f4f6",
                    showgrid: true,
                  },
                  yaxis2: {
                    title: { text: "MA Spread" } as any,
                    overlaying: "y",
                    side: "right",
                    gridcolor: "transparent",
                  },
                  hovermode: "closest",
                  legend: {
                    orientation: "h",
                    y: -0.15,
                    x: 0.5,
                    xanchor: "center",
                  },
                  plot_bgcolor: "#fafafa",
                  paper_bgcolor: "#ffffff",
                }}
                config={{
                  responsive: true,
                  displayModeBar: true,
                  displaylogo: false,
                  scrollZoom: true,
                  modeBarButtonsToAdd: [
                    "drawline",
                    "drawopenpath",
                    "eraseshape",
                  ] as any,
                }}
                className="crypto-chart__chart"
              />
            </div>

            <div className="crypto-chart__stats">
              <div className="crypto-chart__stats-title">📊 Статистика:</div>
              {coins.map((coin) => {
                const coinData = data[coin] as ICurrencyData;
                return (
                  <div key={coin} className="crypto-chart__stats-item">
                    {coin}: {coinData.movingAverages?.length.toLocaleString()}{" "}
                    точек данных
                  </div>
                );
              })}
              {data.avgMaSpread && (
                <div className="crypto-chart__stats-item">
                  avgMaSpread:{" "}
                  {(data.avgMaSpread as number[]).length.toLocaleString()} точек
                </div>
              )}
              <div className="crypto-chart__stats-summary">
                Показывается: ~
                {Math.ceil(
                  ((data[coins[0]] as ICurrencyData)?.movingAverages?.length ||
                    0) / decimation
                ).toLocaleString()}{" "}
                точек
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CryptoChartViewer;
