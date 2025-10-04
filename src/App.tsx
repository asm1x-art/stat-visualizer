import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  type ChangeEvent,
} from "react";
import Plotly from "plotly.js-basic-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import { type PlotData } from "plotly.js-basic-dist-min";
import { dbManager } from "./utils/IndexedDB";
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
  const [loading, setLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [viewRange, setViewRange] = useState<[number, number]>([0, 10000]);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [currentDragMode, setCurrentDragMode] = useState<"pan" | "zoom">("pan");

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

  useEffect(() => {
    dbManager.init().catch((err) => {
      console.error("IndexedDB init error:", err);
      setError("Ошибка инициализации базы данных");
    });
  }, []);

  const calculateFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const loadAllData = async (files: FileList): Promise<void> => {
    setLoading(true);
    setProgress(0);
    setError(null);

    try {
      let metadataFile: File | null = null;
      const chunkFilesMap = new Map<string, File>();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.endsWith(".chunked.visualize.json")) {
          metadataFile = file;
        } else if (
          file.name.includes("chunk_") &&
          file.name.endsWith(".json")
        ) {
          chunkFilesMap.set(file.name, file);
        }
      }

      if (!metadataFile) {
        throw new Error("Не найден .chunked.visualize.json файл");
      }

      setLoadingStatus("Чтение метаданных...");
      const metadataText = await metadataFile.text();
      const meta: IMetadata = JSON.parse(metadataText);

      const metadataHash = await calculateFileHash(metadataFile);
      const cachedMetadata = await dbManager.getMetadata();
      const cachedHash = cachedMetadata
        ? await dbManager.getMetadataHash()
        : null;

      if (cachedHash === metadataHash && cachedMetadata) {
        setLoadingStatus("Данные уже загружены! Используем кэш...");
        setMetadata(cachedMetadata);

        const defaultColorsList = [
          "#8B5CF6",
          "#06B6D4",
          "#10B981",
          "#F59E0B",
          "#EF4444",
        ];
        const newColors: IColors = { avgMaSpread: "#F59E0B" };
        cachedMetadata.coins.forEach((coin, idx) => {
          const baseColor = defaultColorsList[idx % defaultColorsList.length];
          newColors[coin] = {
            movingAverages: baseColor,
            normalizedPrices: baseColor + "CC",
            cumulativeMeans: baseColor + "88",
          };
        });
        setColors(newColors);

        const firstChunk = await dbManager.getChunk(0);
        if (firstChunk) {
          setLoadedChunks(new Map([[0, firstChunk]]));
        }
        setViewRange([
          0,
          Math.min(cachedMetadata.chunkSize, cachedMetadata.totalPoints),
        ]);
        setProgress(100);
        setLoading(false);
        return;
      }

      setLoadingStatus("Очистка старых данных...");
      await dbManager.clearAll();

      await dbManager.saveMetadata(meta);
      await dbManager.saveMetadataHash(metadataHash);
      setMetadata(meta);

      const defaultColorsList = [
        "#8B5CF6",
        "#06B6D4",
        "#10B981",
        "#F59E0B",
        "#EF4444",
      ];
      const newColors: IColors = { avgMaSpread: "#F59E0B" };
      meta.coins.forEach((coin, idx) => {
        const baseColor = defaultColorsList[idx % defaultColorsList.length];
        newColors[coin] = {
          movingAverages: baseColor,
          normalizedPrices: baseColor + "CC",
          cumulativeMeans: baseColor + "88",
        };
      });
      setColors(newColors);

      const BATCH_SIZE = 5;
      const totalChunks = meta.chunks.length;

      for (let i = 0; i < totalChunks; i += BATCH_SIZE) {
        const batchEnd = Math.min(i + BATCH_SIZE, totalChunks);
        const batch = meta.chunks.slice(i, batchEnd);

        const batchPromises = batch.map(async (chunkInfo) => {
          const fileName = chunkInfo.file.split("/").pop() || chunkInfo.file;

          let file = chunkFilesMap.get(fileName);

          if (!file) {
            for (const [name, f] of chunkFilesMap.entries()) {
              if (name.includes(`chunk_${chunkInfo.id}.json`)) {
                file = f;
                break;
              }
            }
          }

          if (!file) {
            throw new Error(
              `Chunk file not found for chunk ${chunkInfo.id}. Expected: ${fileName}`
            );
          }

          const text = await file.text();
          const chunkData: IChunkData = JSON.parse(text);
          await dbManager.saveChunk(chunkInfo.id, chunkData);

          return { chunkId: chunkInfo.id, chunkData };
        });

        const results = await Promise.all(batchPromises);

        if (i === 0) {
          setLoadedChunks(
            new Map(results.map((r) => [r.chunkId, r.chunkData]))
          );
          setViewRange([0, Math.min(meta.chunkSize, meta.totalPoints)]);
        }

        const currentProgress = Math.round((batchEnd / totalChunks) * 100);
        setProgress(currentProgress);
        setLoadingStatus(
          `Кэширование: ${batchEnd}/${totalChunks} чанков (${currentProgress}%)`
        );
      }

      setLoadingStatus("Готово!");
      setTimeout(() => {
        setLoading(false);
        setLoadingStatus("");
      }, 500);
    } catch (err) {
      setError("Ошибка загрузки: " + (err as Error).message);
      setLoading(false);
      setLoadingStatus("");
    }
  };

  const getDataForRange = useCallback(
    async (start: number, end: number): Promise<IChunkData | null> => {
      if (!metadata) return null;

      const chunkSize = metadata.chunkSize;
      const startChunkId = Math.floor(start / chunkSize);
      const endChunkId = Math.floor(end / chunkSize);

      const mergedData: IChunkData = { avgMaSpread: [] };
      metadata.coins.forEach((coin) => {
        mergedData[coin] = {
          movingAverages: [],
          normalizedPrices: [],
          cumulativeMeans: [],
        };
      });

      for (let chunkId = startChunkId; chunkId <= endChunkId; chunkId++) {
        let chunk = loadedChunks.get(chunkId);

        if (!chunk) {
          const dbChunk = await dbManager.getChunk(chunkId);
          if (dbChunk) {
            chunk = dbChunk;
            setLoadedChunks((prev) => new Map(prev).set(chunkId, dbChunk));
          }
        }

        if (!chunk) continue;

        const chunkStart = chunkId * chunkSize;
        const localStart = Math.max(0, start - chunkStart);
        const localEnd = Math.min(chunkSize, end - chunkStart);

        metadata.coins.forEach((coin) => {
          const coinData = chunk![coin] as ICurrencyData;
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

  const [rangeData, setRangeData] = useState<IChunkData | null>(null);

  useEffect(() => {
    if (metadata) {
      getDataForRange(viewRange[0], viewRange[1]).then(setRangeData);
    }
  }, [viewRange, metadata, getDataForRange]);

  const plotData = useMemo((): Partial<PlotData>[] => {
    if (!metadata || !rangeData) return [];

    const traces: Partial<PlotData>[] = [];
    const coins = metadata.coins;

    coins.forEach((coin) => {
      const coinData = rangeData[coin] as ICurrencyData;

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

    if (visibility.avgMaSpread && rangeData.avgMaSpread) {
      const spreadData = rangeData.avgMaSpread as number[];
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
  }, [metadata, rangeData, viewRange, visibility, colors]);

  const handleRelayout = useCallback(
    (event: any) => {
      if (!metadata) return;

      if (event.dragmode) {
        setCurrentDragMode(event.dragmode);
      }

      if (
        event["xaxis.range[0]"] !== undefined &&
        event["xaxis.range[1]"] !== undefined
      ) {
        const newStart = Math.max(0, Math.floor(event["xaxis.range[0]"]));
        const newEnd = Math.min(
          metadata.totalPoints,
          Math.ceil(event["xaxis.range[1]"])
        );
        setViewRange([newStart, newEnd]);
      }
    },
    [metadata]
  );

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    loadAllData(files);
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
          Crypto Visual Data Analyzer (IndexedDB Cache)
        </h1>

        <div className="crypto-chart__upload">
          <label className="crypto-chart__upload-label">
            Загрузить файлы данных
            <input
              type="file"
              accept=".json"
              onChange={handleFileChange}
              className="crypto-chart__upload-input"
              multiple
            />
          </label>
          <div className="crypto-chart__upload-hint">
            Выберите все файлы: .chunked.visualize.json и все chunk_*.json
          </div>
        </div>

        {loading && (
          <div className="crypto-chart__loader">
            <div className="crypto-chart__loader-spinner" />
            <div className="crypto-chart__loader-progress">{progress}%</div>
            <div className="crypto-chart__loader-text">{loadingStatus}</div>
          </div>
        )}

        {error && <div className="crypto-chart__error">{error}</div>}

        {metadata && !loading && (
          <>
            <div
              style={{ display: "flex", gap: "20px", flexDirection: "column" }}
            >
              <div className="crypto-chart__chart-wrapper">
                <Plot
                  data={plotData}
                  layout={{
                    autosize: true,
                    height: 700,
                    dragmode: currentDragMode,
                    title: {
                      text: `Визуализация данных (1 минута таймфрейм)`,
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
                  }}
                  onRelayout={handleRelayout}
                  className="crypto-chart__chart"
                />
              </div>

              <div className="crypto-chart__stats">
                <div className="crypto-chart__stats-title">Статистика:</div>
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
                    Диапазон: {viewRange[0].toLocaleString()} -{" "}
                    {viewRange[1].toLocaleString()}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setSettingsOpen(!settingsOpen)}
                className={`crypto-chart__settings-toggle ${
                  settingsOpen
                    ? "crypto-chart__settings-toggle--open"
                    : "crypto-chart__settings-toggle--closed"
                }`}
              >
                <span>Настройки отображения</span>
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
                      Показывать данные:
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
                        Цвета {coin}:
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
                      Цвет Spread:
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
