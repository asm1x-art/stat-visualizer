import React, { useState, useEffect, useRef, type ChangeEvent } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { dbManager } from "./utils/indexedDB";
import "./App.css";

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

// Палитра цветов для автоматического назначения
const DEFAULT_COLOR_PALETTE = [
  "#8B5CF6", // Purple
  "#06B6D4", // Cyan
  "#10B981", // Green
  "#F59E0B", // Amber
  "#EF4444", // Red
  "#EC4899", // Pink
  "#8B5CF6", // Violet
  "#14B8A6", // Teal
];

// Функция генерации начальных цветов на основе монет
const generateColorsFromCoins = (coins: string[]): IColors => {
  const colors: IColors = { avgMaSpread: "#F59E0B" };

  coins.forEach((coin, idx) => {
    const baseColor = DEFAULT_COLOR_PALETTE[idx % DEFAULT_COLOR_PALETTE.length];
    colors[coin] = {
      movingAverages: baseColor,
      normalizedPrices: baseColor + "CC", // С прозрачностью 80%
      cumulativeMeans: baseColor + "88", // С прозрачностью 53%
    };
  });

  return colors;
};

const CryptoChartViewer: React.FC = () => {
  const [metadata, setMetadata] = useState<IMetadata | null>(null);
  const [loadedChunks, setLoadedChunks] = useState<Map<number, IChunkData>>(
    new Map()
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [loadingStatus, setLoadingStatus] = useState<string>("");
  const [cursorMode, _] = useState<"pan" | "zoom">("pan");
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotInstance = useRef<uPlot | null>(null);

  const [visibility, setVisibility] = useState<IVisibility>({
    movingAverages: true,
    normalizedPrices: false,
    cumulativeMeans: false,
    avgMaSpread: true,
  });

  // Инициализируем пустым объектом, заполним при загрузке данных
  const [colors, setColors] = useState<IColors>({
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
        setLoadingStatus("Данные уже загружены! Загружаем из кэша...");
        setMetadata(cachedMetadata);

        // Генерируем цвета на основе монет из кэша
        const newColors = generateColorsFromCoins(cachedMetadata.coins);
        setColors(newColors);

        setLoadingStatus("Загрузка всех чанков в память...");
        const allChunks = new Map<number, IChunkData>();
        for (let i = 0; i < cachedMetadata.chunks.length; i++) {
          const chunk = await dbManager.getChunk(i);
          if (chunk) {
            allChunks.set(i, chunk);
          }
          if (i % 10 === 0) {
            setProgress(Math.round((i / cachedMetadata.chunks.length) * 100));
          }
        }
        setLoadedChunks(allChunks);

        setProgress(100);
        setLoading(false);
        return;
      }

      setLoadingStatus("Очистка старых данных...");
      await dbManager.clearAll();

      await dbManager.saveMetadata(meta);
      await dbManager.saveMetadataHash(metadataHash);
      setMetadata(meta);

      // Генерируем цвета на основе монет из новых данных
      const newColors = generateColorsFromCoins(meta.coins);
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
            throw new Error(`Chunk file not found for chunk ${chunkInfo.id}`);
          }

          const text = await file.text();
          const chunkData: IChunkData = JSON.parse(text);
          await dbManager.saveChunk(chunkInfo.id, chunkData);

          return { chunkId: chunkInfo.id, chunkData };
        });

        await Promise.all(batchPromises);

        const currentProgress = Math.round((batchEnd / totalChunks) * 100);
        setProgress(currentProgress);
        setLoadingStatus(`Кэширование: ${batchEnd}/${totalChunks} чанков`);
      }

      setLoadingStatus("Загрузка всех чанков в память...");
      const allChunks = new Map<number, IChunkData>();
      for (let i = 0; i < totalChunks; i++) {
        const chunk = await dbManager.getChunk(i);
        if (chunk) {
          allChunks.set(i, chunk);
        }
      }
      setLoadedChunks(allChunks);

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

  useEffect(() => {
    if (!metadata || loadedChunks.size === 0 || !chartRef.current) return;

    const allData: uPlot.AlignedData = [[]];
    const series: uPlot.Series[] = [{}];

    metadata.coins.forEach((coin) => {
      const coinColors = colors[coin] as ICoinColors;

      (
        Object.keys(visibility).filter(
          (k) => k !== "avgMaSpread"
        ) as TDataType[]
      ).forEach((dataType) => {
        if (!visibility[dataType]) return;

        const data: number[] = [];

        for (let chunkId = 0; chunkId < metadata.chunks.length; chunkId++) {
          const chunk = loadedChunks.get(chunkId);
          if (!chunk) continue;

          const coinData = chunk[coin] as ICurrencyData;
          data.push(...coinData[dataType]);
        }

        allData.push(data);
        series.push({
          label: `${coin} - ${dataType}`,
          stroke: coinColors[dataType],
          width: 2,
        });
      });
    });

    if (visibility.avgMaSpread) {
      const spreadData: number[] = [];
      for (let chunkId = 0; chunkId < metadata.chunks.length; chunkId++) {
        const chunk = loadedChunks.get(chunkId);
        if (!chunk) continue;
        spreadData.push(...(chunk.avgMaSpread as number[]));
      }
      allData.push(spreadData);
      series.push({
        label: "MA Spread",
        stroke: colors.avgMaSpread as string,
        width: 2,
      });
    }

    allData[0] = Array.from({ length: allData[1]?.length || 0 }, (_, i) => i);

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: 700,
      series,
      scales: {
        x: {
          time: false,
        },
        y: {
          auto: true,
        },
      },
      cursor: {
        drag: {
          x: false,
          y: false,
        },
      },
      axes: [
        {
          label: "Индекс (минуты)",
          stroke: "#1f2937",
          grid: { show: true, stroke: "#f3f4f6" },
        },
        {
          label: "Значение",
          stroke: "#1f2937",
          grid: { show: true, stroke: "#f3f4f6" },
        },
      ],
      hooks: {
        init: [
          (u) => {
            const over = u.over;
            let isDragging = false;
            let startX: number, startY: number;
            let xMin: number, xMax: number, yMin: number, yMax: number;

            const onMouseDown = (e: MouseEvent) => {
              if (e.button !== 0 || cursorMode !== "pan") return;

              isDragging = true;
              startX = e.clientX;
              startY = e.clientY;

              xMin = u.scales.x.min!;
              xMax = u.scales.x.max!;
              yMin = u.scales.y.min!;
              yMax = u.scales.y.max!;

              document.addEventListener("mousemove", onMouseMove);
              document.addEventListener("mouseup", onMouseUp);

              e.preventDefault();
            };

            const onMouseMove = (e: MouseEvent) => {
              if (!isDragging) return;

              e.preventDefault();

              const rect = over.getBoundingClientRect();

              const deltaXPx = e.clientX - startX;
              const deltaYPx = e.clientY - startY;

              const xRange = xMax - xMin;
              const yRange = yMax - yMin;

              const deltaXData = -(deltaXPx / rect.width) * xRange;
              const deltaYData = (deltaYPx / rect.height) * yRange;

              u.setScale("x", {
                min: xMin + deltaXData,
                max: xMax + deltaXData,
              });

              u.setScale("y", {
                min: yMin + deltaYData,
                max: yMax + deltaYData,
              });
            };

            const onMouseUp = () => {
              isDragging = false;
              document.removeEventListener("mousemove", onMouseMove);
              document.removeEventListener("mouseup", onMouseUp);
            };

            over.addEventListener("mousedown", onMouseDown);
          },
        ],
        ready: [
          (u) => {
            const over = u.over;
            over.addEventListener("wheel", (e: WheelEvent) => {
              e.preventDefault();

              const { left } = over.getBoundingClientRect();
              const xVal = u.posToVal(e.clientX - left, "x");
              const factor = e.deltaY < 0 ? 0.75 : 1.25;

              const xMin = u.scales.x.min!;
              const xMax = u.scales.x.max!;
              const xRange = xMax - xMin;
              const newRange = xRange * factor;

              const leftPct = (xVal - xMin) / xRange;
              const newMin = xVal - leftPct * newRange;
              const newMax = newMin + newRange;

              u.batch(() => {
                u.setScale("x", { min: newMin, max: newMax });
              });
            });
          },
        ],
      },
    };

    if (uplotInstance.current) {
      uplotInstance.current.destroy();
    }

    uplotInstance.current = new uPlot(opts, allData, chartRef.current);

    const handleResize = () => {
      if (uplotInstance.current && chartRef.current) {
        uplotInstance.current.setSize({
          width: chartRef.current.clientWidth,
          height: 700,
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (uplotInstance.current) {
        uplotInstance.current.destroy();
        uplotInstance.current = null;
      }
    };
  }, [metadata, loadedChunks, visibility, colors, cursorMode]);

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
        <h1 className="crypto-chart__title">Arby Stat Coin Visualizer</h1>

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
              <div
                ref={chartRef}
                className="crypto-chart__chart-wrapper"
                style={{ width: "100%", height: "700px" }}
              />

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
                    Загружено: {loadedChunks.size} / {metadata.chunks.length}{" "}
                    чанков
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
