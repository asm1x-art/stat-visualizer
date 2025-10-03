import React, { useState, useMemo, useCallback, type ChangeEvent } from "react";
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

interface IChunkInfo {
  id: number;
  startIndex: number;
  endIndex: number;
  file: string;
}

interface IMetadata {
  coins: string[];
  koef: number;
  totalPoints: number;
  chunkSize: number;
  chunks: IChunkInfo[];
}

interface IChunkData {
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
  const [metadata, setMetadata] = useState<IMetadata | null>(null);
  const [loadedChunks, setLoadedChunks] = useState<Map<number, IChunkData>>(
    new Map()
  );
  const [chunkFiles, setChunkFiles] = useState<Map<string, File>>(new Map());
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingChunks, setLoadingChunks] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [viewRange, setViewRange] = useState<[number, number]>([0, 10000]);
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

  const loadMetadata = async (file: File, files: FileList): Promise<void> => {
    setLoading(true);
    setProgress(0);
    setError(null);

    try {
      const reader = new FileReader();

      reader.onload = async (e: ProgressEvent<FileReader>) => {
        try {
          const result = e.target?.result;
          if (typeof result === "string") {
            const meta: IMetadata = JSON.parse(result);
            setMetadata(meta);

            // Индексируем все chunk файлы
            const fileMap = new Map<string, File>();
            for (let i = 0; i < files.length; i++) {
              const f = files[i];
              fileMap.set(f.name, f);
            }
            setChunkFiles(fileMap);

            // Автоматически создаём цвета для монет
            const defaultColorsList = [
              "#8B5CF6",
              "#06B6D4",
              "#10B981",
              "#F59E0B",
              "#EF4444",
            ];
            const newColors: IColors = { avgMaSpread: "#F59E0B" };

            meta.coins.forEach((coin, idx) => {
              const baseColor =
                defaultColorsList[idx % defaultColorsList.length];
              newColors[coin] = {
                movingAverages: baseColor,
                normalizedPrices: baseColor + "CC",
                cumulativeMeans: baseColor + "88",
              };
            });
            setColors(newColors);

            // Загружаем первый чанк автоматически
            await loadChunksForRange(
              0,
              Math.min(meta.chunkSize, meta.totalPoints),
              meta,
              fileMap
            );
            setViewRange([0, Math.min(meta.chunkSize, meta.totalPoints)]);
          }
          setProgress(100);
          setTimeout(() => setLoading(false), 300);
        } catch (err) {
          setError("Ошибка парсинга metadata: " + (err as Error).message);
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

  const loadChunksForRange = async (
    start: number,
    end: number,
    meta: IMetadata,
    files: Map<string, File>
  ): Promise<void> => {
    if (!meta) return;

    const chunkSize = meta.chunkSize;
    const startChunkId = Math.floor(start / chunkSize);
    const endChunkId = Math.floor(end / chunkSize);

    const chunksToLoad: number[] = [];
    for (let i = startChunkId; i <= endChunkId; i++) {
      if (!loadedChunks.has(i) && i < meta.chunks.length) {
        chunksToLoad.push(i);
      }
    }

    if (chunksToLoad.length === 0) return;

    setLoadingChunks(true);

    try {
      const chunkPromises = chunksToLoad.map(async (chunkId) => {
        const chunkInfo = meta.chunks[chunkId];
        const fileName = chunkInfo.file.split("/").pop() || chunkInfo.file;
        const file = files.get(fileName);

        if (!file) {
          throw new Error(`Chunk file not found: ${fileName}`);
        }

        return new Promise<{ chunkId: number; chunkData: IChunkData }>(
          (resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              try {
                const result = e.target?.result;
                if (typeof result === "string") {
                  const chunkData: IChunkData = JSON.parse(result);
                  resolve({ chunkId, chunkData });
                }
              } catch (err) {
                reject(err);
              }
            };
            reader.onerror = () =>
              reject(new Error(`Failed to read chunk ${chunkId}`));
            reader.readAsText(file);
          }
        );
      });

      const results = await Promise.all(chunkPromises);

      setLoadedChunks((prev) => {
        const newMap = new Map(prev);
        results.forEach(({ chunkId, chunkData }) => {
          newMap.set(chunkId, chunkData);
        });
        return newMap;
      });

      setProgress(100);
    } catch (err) {
      setError("Ошибка загрузки чанков: " + (err as Error).message);
    } finally {
      setLoadingChunks(false);
    }
  };

  const getDataForRange = useCallback(
    (start: number, end: number): IChunkData | null => {
      if (!metadata) return null;

      const chunkSize = metadata.chunkSize;
      const startChunkId = Math.floor(start / chunkSize);
      const endChunkId = Math.floor(end / chunkSize);

      const mergedData: IChunkData = {
        avgMaSpread: [],
      };

      metadata.coins.forEach((coin) => {
        mergedData[coin] = {
          movingAverages: [],
          normalizedPrices: [],
          cumulativeMeans: [],
        };
      });

      for (let chunkId = startChunkId; chunkId <= endChunkId; chunkId++) {
        const chunk = loadedChunks.get(chunkId);
        if (!chunk) continue;

        const chunkStart = chunkId * chunkSize;

        const localStart = Math.max(0, start - chunkStart);
        const localEnd = Math.min(chunkSize, end - chunkStart);

        metadata.coins.forEach((coin) => {
          const coinData = chunk[coin] as ICurrencyData;
          const targetData = mergedData[coin] as ICurrencyData;

          targetData.movingAverages.push(
            ...coinData.movingAverages.slice(localStart, localEnd)
          );
          targetData.normalizedPrices.push(
            ...coinData.normalizedPrices.slice(localStart, localEnd)
          );
          targetData.cumulativeMeans.push(
            ...coinData.cumulativeMeans.slice(localStart, localEnd)
          );
        });

        const spreadData = chunk.avgMaSpread as number[];
        (mergedData.avgMaSpread as number[]).push(
          ...spreadData.slice(localStart, localEnd)
        );
      }

      return mergedData;
    },
    [metadata, loadedChunks]
  );

  const plotData = useMemo((): Partial<PlotData>[] => {
    if (!metadata) return [];

    const data = getDataForRange(viewRange[0], viewRange[1]);
    if (!data) return [];

    const traces: Partial<PlotData>[] = [];
    const coins = metadata.coins;

    coins.forEach((coin) => {
      const coinData = data[coin] as ICurrencyData;

      (Object.keys(visibility) as Array<keyof IVisibility>).forEach(
        (dataType) => {
          if (dataType === "avgMaSpread") return;

          if (visibility[dataType] && coinData[dataType as TDataType]) {
            const arrayData = coinData[dataType as TDataType] as number[];
            const xValues = arrayData.map((_, i) => viewRange[0] + i);

            traces.push({
              x: xValues,
              y: arrayData,
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
      const spreadData = data.avgMaSpread as number[];
      const xValues = spreadData.map((_, i) => viewRange[0] + i);

      traces.push({
        x: xValues,
        y: spreadData,
        type: "scatter",
        mode: "lines",
        name: "MA Spread",
        line: { color: colors.avgMaSpread, width: 2 },
        yaxis: "y2",
        hovertemplate: `MA Spread<br>Index: %{x}<br>Value: %{y:.8e}<extra></extra>`,
      });
    }

    return traces;
  }, [metadata, viewRange, visibility, colors, getDataForRange]);

  const handleRelayout = useCallback(
    async (event: any) => {
      if (!metadata || chunkFiles.size === 0) return;

      if (
        event["xaxis.range[0]"] !== undefined &&
        event["xaxis.range[1]"] !== undefined
      ) {
        const newStart = Math.max(0, Math.floor(event["xaxis.range[0]"]));
        const newEnd = Math.min(
          metadata.totalPoints,
          Math.ceil(event["xaxis.range[1]"])
        );

        const buffer = metadata.chunkSize;
        const loadStart = Math.max(0, newStart - buffer);
        const loadEnd = Math.min(metadata.totalPoints, newEnd + buffer);

        await loadChunksForRange(loadStart, loadEnd, metadata, chunkFiles);
        setViewRange([newStart, newEnd]);
      }
    },
    [metadata, chunkFiles]
  );

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Ищем metadata файл
    let metadataFile: File | null = null;
    for (let i = 0; i < files.length; i++) {
      if (files[i].name.endsWith(".chunked.visualize.json")) {
        metadataFile = files[i];
        break;
      }
    }

    if (!metadataFile) {
      setError("Не найден .chunked.visualize.json файл");
      return;
    }

    loadMetadata(metadataFile, files);
  };

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

  const coins = metadata?.coins || [];

  return (
    <div className="crypto-chart">
      <div className="crypto-chart__container">
        <h1 className="crypto-chart__title">
          📊 Crypto Visual Data Analyzer (Chunked)
        </h1>

        <div className="crypto-chart__upload">
          <label className="crypto-chart__upload-label">
            📁 Загрузить файлы данных
            <input
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="crypto-chart__upload-input"
              multiple
            />
          </label>
          <div className="crypto-chart__upload-hint">
            Выберите все файлы: .chunked.visualize.json и все chunk_*.json из
            папки chunks/
          </div>
        </div>

        {loading && (
          <div className="crypto-chart__loader">
            <div className="crypto-chart__loader-spinner" />
            <div className="crypto-chart__loader-progress">{progress}%</div>
            <div className="crypto-chart__loader-text">Загрузка чанков...</div>
          </div>
        )}

        {error && <div className="crypto-chart__error">⚠️ {error}</div>}

        {loadingChunks && (
          <div
            style={{
              position: "fixed",
              bottom: "20px",
              right: "20px",
              background: "rgba(102, 126, 234, 0.9)",
              color: "white",
              padding: "12px 20px",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: "600",
              boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
              zIndex: 1000,
            }}
          >
            ⏳ Загрузка чанков...
          </div>
        )}

        {metadata && !loading && (
          <>
            <div
              style={{ display: "flex", gap: "20px", flexDirection: "column" }}
            >
              {/* Chart - главный элемент сверху */}
              <div className="crypto-chart__chart-wrapper">
                <Plot
                  data={plotData}
                  layout={{
                    autosize: true,
                    height: 700,
                    title: {
                      text: `📈 Визуализация данных (1 минута таймфрейм) - Chunked Mode`,
                      font: { size: 20, color: "#1f2937" },
                    } as any,
                    xaxis: {
                      title: { text: "Индекс (минуты)" } as any,
                      gridcolor: "#f3f4f6",
                      showgrid: true,
                      range: viewRange,
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
                  onRelayout={handleRelayout}
                  className="crypto-chart__chart"
                />
              </div>

              {/* Stats под графиком */}
              <div className="crypto-chart__stats">
                <div className="crypto-chart__stats-title">📊 Статистика:</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "8px",
                  }}
                >
                  <div className="crypto-chart__stats-item">
                    Всего точек: {metadata.totalPoints.toLocaleString()}
                  </div>
                  <div className="crypto-chart__stats-item">
                    Размер чанка: {metadata.chunkSize.toLocaleString()} точек
                  </div>
                  <div className="crypto-chart__stats-item">
                    Загружено чанков: {loadedChunks.size} /{" "}
                    {metadata.chunks.length}
                  </div>
                  <div className="crypto-chart__stats-item">
                    Диапазон: {viewRange[0].toLocaleString()} -{" "}
                    {viewRange[1].toLocaleString()} (
                    {(viewRange[1] - viewRange[0]).toLocaleString()} точек)
                  </div>
                </div>
              </div>

              {/* Настройки - collapsible */}
              <button
                onClick={() => setSettingsOpen(!settingsOpen)}
                className={`crypto-chart__settings-toggle ${
                  settingsOpen
                    ? "crypto-chart__settings-toggle--open"
                    : "crypto-chart__settings-toggle--closed"
                }`}
              >
                <span>⚙️ Настройки отображения</span>
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
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CryptoChartViewer;
