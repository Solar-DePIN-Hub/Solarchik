// @ts-nocheck
import { useEffect, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { CLASS_META, aprLabel, eventsDaysOf, laneEnabledOn, lanesForStrategy, listEligible, quoteResaleSol, workLabel } from "@/lib/agents/classes";
import { liveCatalog } from "@/lib/agents/catalog";
import { deriveDepositWallet } from "@/lib/agents/deposit-wallet";
import { GROK_MODEL } from "@/lib/agents/grok-model";
import { SLICE_STOCKS } from "@/lib/agents/slice-stocks";
import { useAgents } from "@/lib/agents/store";
import { healDevnet } from "@/lib/agents/rpc-heal";
import { readMainnetBalance, readMainnetSlot } from "@/lib/agents/mainnet";
import { revealRoomSecret } from "@/lib/agents/wallet";
import { cn, formatSol, shortKey } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { AgentBay } from "./agent-bay";
import { AgentConsole } from "./agent-console";
import { IconCopy, IconPlay, IconStop, IconWallet } from "./icons";
import { useWorkLoop } from "./use-work-loop";

var CLASS_IDS = [
	1,
	2,
	3
];
var TABS = [
	{ id: "room", label: "Гаманець", hint: "Ключ і баланси" },
	{ id: "work", label: "Праця", hint: "Агенти в лімітах" },
	{ id: "store", label: "Магазин", hint: "Купити агента" },
	{ id: "slice", label: "Акції", hint: "Купівля акцій" }
];
function SlicePanel() {
	const wallet = useAgents((s) => s.wallet);
	const chainBusy = useAgents((s) => s.chainBusy);
	const [sol, setSol] = useState("0.02");
	const [mint, setMint] = useState(SLICE_STOCKS[0].mint);
	return /* @__PURE__ */ jsxs("section", {
		className: "mx-auto mt-3 max-w-5xl rounded-lg border border-border bg-surface p-4",
		"data-testid": "slice-panel",
		children: [
			/* @__PURE__ */ jsx("h2", { className: "text-sm font-medium", children: "Slice" }),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-sm text-muted leading-normal",
				children: "Покупка йде ключем гаманця агента через Jupiter, ті самі акції що на Slice. Сайт Slice окремо не бачить цей ключ."
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-2 break-all font-mono text-xs",
				children: wallet ? wallet.pubkey : "Гаманця агента ще немає."
			}),
			/* @__PURE__ */ jsx("a", {
				className: "mt-2 inline-flex h-11 items-center text-sm underline",
				href: "https://slice-solana.netlify.app/",
				target: "_blank",
				rel: "noreferrer",
				children: "Відкрити сайт Slice"
			}),
			/* @__PURE__ */ jsx("div", {
				className: "mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5",
				children: SLICE_STOCKS.map((s) => /* @__PURE__ */ jsx("button", {
					type: "button",
					"data-testid": `slice-${s.name}`,
					onClick: () => setMint(s.mint),
					className: mint === s.mint ? "h-11 rounded-md border border-accent bg-elevated text-sm" : "h-11 rounded-md border border-border text-sm text-muted",
					children: s.name
				}, s.mint))
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-3 flex flex-wrap gap-2",
				children: [
					/* @__PURE__ */ jsx("input", {
						className: "h-11 w-28 rounded-md border border-border bg-bg px-3 text-sm tabular-nums",
						inputMode: "decimal",
						"aria-label": "SOL на акцію",
						value: sol,
						onChange: (e) => setSol(e.target.value)
					}),
					/* @__PURE__ */ jsx(Button, {
						disabled: !wallet || chainBusy,
						"data-testid": "slice-buy",
						onClick: () => void useAgents.getState().buySlice(mint, Number(sol.replace(",", "."))),
						children: "Купити ключем агента"
					})
				]
			})
		]
	});
}
function WorkApp() {
	const hydrate = useAgents((s) => s.hydrate);
	const tab = useAgents((s) => s.tab);
	const setTab = useAgents((s) => s.setTab);
	useEffect(() => {
		void healDevnet().finally(() => {
			hydrate().then(() => {
				const t = useAgents.getState().tab;
				if (t === "work" || t === "store" || t === "room") useAgents.getState().ensureWallet();
			});
		});
	}, [hydrate]);
	useWorkLoop();
	return /* @__PURE__ */ jsxs("main", {
		className: "min-h-dvh bg-bg text-fg flex flex-col",
		children: [
			/* @__PURE__ */ jsx("div", {
				className: "pointer-events-none fixed inset-0 opacity-35 bg-cover bg-center",
				style: { backgroundImage: "url(/room.jpg)" },
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ jsx("div", {
				className: "pointer-events-none fixed inset-0 bg-scrim",
				"aria-hidden": "true"
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "relative z-10 flex h-dvh flex-col",
				children: [
					/* @__PURE__ */ jsx(TopBar, {}),
					/* @__PURE__ */ jsx("div", {
						className: "flex-1 min-h-0 overflow-y-auto px-4 pb-40 pt-3 sm:px-6",
						children: /* @__PURE__ */ jsxs("div", {
							className: "mx-auto w-full max-w-5xl",
							children: [
								tab === "room" && /* @__PURE__ */ jsx(WalletDesk, {}),
								/* @__PURE__ */ jsx(TradeGate, {}),
								/* @__PURE__ */ jsx(PolyGate, {}),
								/* @__PURE__ */ jsx(PolyCancelGate, {}),
								/* @__PURE__ */ jsx(PolyRedeemGate, {}),
								tab === "room" && /* @__PURE__ */ jsx(RoomPanel, {}),
								tab === "work" && /* @__PURE__ */ jsx(WorkPanel, {}),
								tab === "store" && /* @__PURE__ */ jsx(StorePanel, {}),
								tab === "slice" && /* @__PURE__ */ jsx(SlicePanel, {})
							]
						})
					}),
					/* @__PURE__ */ jsxs("nav", {
						className: "fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2",
						"aria-label": "Розділи столу",
						children: [
							/* @__PURE__ */ jsx("div", {
								className: "mx-auto grid max-w-5xl grid-cols-4 gap-1 px-3",
								children: TABS.map((t) => /* @__PURE__ */ jsx("button", {
									"data-testid": `tab-${t.id}`,
									onClick: () => setTab(t.id),
									className: cn("h-11 rounded-md text-sm font-semibold", tab === t.id ? "bg-primary text-primary-fg" : "text-muted"),
									children: t.label
								}, t.id))
							})
						]
					})
				]
			})
		]
	});
}
function TopBar() {
	const wallet = useAgents((s) => s.wallet);
	const sol = useAgents((s) => s.sol);
	const solKnown = useAgents((s) => s.solKnown);
	const solMiss = useAgents((s) => s.solMiss);
	const notice = useAgents((s) => s.notice);
	const setTab = useAgents((s) => s.setTab);
	const [copied, setCopied] = useState(false);
	async function copyKey() {
		if (!wallet) return;
		try {
			await navigator.clipboard.writeText(wallet.pubkey);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {}
	}
	return /* @__PURE__ */ jsxs("header", {
		className: "border-b border-border bg-bg/80 px-4 py-3 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))]",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "mx-auto flex max-w-5xl items-center justify-between gap-3",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "min-w-0",
					children: [/* @__PURE__ */ jsx("p", {
						className: "text-xs uppercase tracking-wide text-muted",
						children: "Соларчик · тестовий Devnet"
					}), /* @__PURE__ */ jsx("h1", {
						className: "font-display text-lg leading-tight",
						children: "Робочий стіл"
					})]
				}), /* @__PURE__ */ jsxs("div", {
					className: "flex items-center gap-2",
					children: [wallet ? /* @__PURE__ */ jsx("button", {
						type: "button",
						"data-testid": "copy-wallet",
						onClick: () => void copyKey(),
						"aria-label": copied ? "Адресу скопійовано" : `Скопіювати ${wallet.pubkey}`,
						className: "flex h-11 w-11 items-center justify-center rounded-md border border-border bg-elevated",
						children: /* @__PURE__ */ jsx(IconCopy, { size: 16 })
					}) : null, /* @__PURE__ */ jsxs("button", {
						type: "button",
						onClick: () => setTab("room"),
						"aria-label": wallet ? `Гаманець ${wallet.pubkey}, ${solMiss ? "немає цифри" : solKnown ? formatSol(sol) : "читаю"} SOL Devnet` : "Гаманець створюється",
						className: "flex min-h-11 max-w-[11.5rem] items-center gap-2 rounded-md border border-border bg-elevated px-3 py-1 text-left",
						children: [/* @__PURE__ */ jsx(IconWallet, { size: 18 }), /* @__PURE__ */ jsxs("span", {
							className: "min-w-0",
							children: [
								/* @__PURE__ */ jsx("span", {
									className: "block truncate font-mono text-xs tabular-nums",
									children: wallet ? shortKey(wallet.pubkey, 4, 4) : "створюю…"
								}),
								/* @__PURE__ */ jsx("span", {
									className: "block truncate text-xs text-muted tabular-nums",
									"data-testid": "header-devnet",
									children: solMiss ? "немає цифри" : !solKnown ? "читаю…" : `${formatSol(sol)} SOL`
								})
							]
						})]
					})]
				})]
			}),
			notice ? /* @__PURE__ */ jsx("p", {
				className: "mx-auto mt-1 max-w-5xl text-xs text-accent",
				children: notice
			}) : null
		]
	});
}
function shortTwap(exact) {
	const [whole, frac = ""] = exact.split(".");
	return `${whole}.${(frac + "00").slice(0, 2)}`;
}
function TwapRow({ label, row, testId }) {
	let text = "читаю…";
	if (row) {
		if (!row.known) text = "немає цифри";
		else if (row.stale || !row.price) text = "застарів";
		else text = `${shortTwap(row.price)} · ${row.ageSec ?? 0} с`;
	}
	return /* @__PURE__ */ jsxs("p", {
		className: "mt-1 text-sm tabular-nums",
		"data-testid": testId,
		children: [
			label,
			" · ",
			text
		]
	});
}
function WalletDesk() {
	const wallet = useAgents((s) => s.wallet);
	const sol = useAgents((s) => s.sol);
	const solKnown = useAgents((s) => s.solKnown);
	const solMiss = useAgents((s) => s.solMiss);
	const chainBusy = useAgents((s) => s.chainBusy);
	const deposit = useAgents((s) => s.deposit);
	const withdraw = useAgents((s) => s.withdraw);
	const setExternalWallet = useAgents((s) => s.setExternalWallet);
	const externalWallet = useAgents((s) => s.externalWallet);
	const externalSol = useAgents((s) => s.externalSol);
	const working = useAgents((s) => s.working);
	const pending = useAgents((s) => s.pendingTrade);
	const haltReason = useAgents((s) => s.haltReason);
	const lossStreak = useAgents((s) => s.lossStreak);
	const daySpent = useAgents((s) => s.daySpent);
	const sessionSpent = useAgents((s) => s.sessionSpent);
	const liveArmed = useAgents((s) => s.liveArmed);
	const liveAck = useAgents((s) => s.liveAck);
	const autoRun = useAgents((s) => s.autoRun);
	const setLiveArmed = useAgents((s) => s.setLiveArmed);
	const setLiveAck = useAgents((s) => s.setLiveAck);
	const setAutoRun = useAgents((s) => s.setAutoRun);
	const secretSeen = useAgents((s) => s.secretSeen);
	const markSecretSeen = useAgents((s) => s.markSecretSeen);
	const restoreRoomKey = useAgents((s) => s.restoreRoomKey);
	const restorePolygonKey = useAgents((s) => s.restorePolygonKey);
	const roomMainnetSol = useAgents((s) => s.roomMainnetSol);
	const roomMainnetSolKnown = useAgents((s) => s.roomMainnetSolKnown);
	const roomMainnetUsdc = useAgents((s) => s.roomMainnetUsdc);
	const roomMainnetUsdcKnown = useAgents((s) => s.roomMainnetUsdcKnown);
	const lastLiveSig = useAgents((s) => s.lastLiveSig);
	const polyAddress = useAgents((s) => s.polyAddress);
	const polyPol = useAgents((s) => s.polyPol);
	const polyPusd = useAgents((s) => s.polyPusd);
	const polyKnown = useAgents((s) => s.polyKnown);
	const twap = useAgents((s) => s.twap);
	const polyOpenId = useAgents((s) => s.polyOpenId);
	const polyHold = useAgents((s) => s.polyHold);
	const polyBooks = useAgents((s) => s.polyBooks);
	const grokFlight = useAgents((s) => s.grokFlight);
	const lastGrok = useAgents((s) => s.lastGrok);
	const lastPolyOrder = useAgents((s) => s.lastPolyOrder);
	const lastPolyStatus = useAgents((s) => s.lastPolyStatus);
	const bridgeSvm = useAgents((s) => s.bridgeSvm);
	const bridgeWhy = useAgents((s) => s.bridgeWhy);
	const bridgePlan = useAgents((s) => s.bridgePlan);
	const bridgeBusy = useAgents((s) => s.bridgeBusy);
	const bridgeStatus = useAgents((s) => s.bridgeStatus);
	const prepareBridgeDeposit = useAgents((s) => s.prepareBridgeDeposit);
	const reviewPoly = useAgents((s) => s.reviewPoly);
	const [to, setTo] = useState("");
	const [polyTo, setPolyTo] = useState("");
	const [amount, setAmount] = useState("0.05");
	const [topup, setTopup] = useState("1");
	const [mainnetSlot, setMainnetSlot] = useState(null);
	const [secretArm, setSecretArm] = useState(false);
	const [secret, setSecret] = useState("");
	const [restore, setRestore] = useState("");
	const [restoring, setRestoring] = useState(false);
	const [polyArm, setPolyArm] = useState(false);
	const [polySecret, setPolySecret] = useState("");
	const [polyRestore, setPolyRestore] = useState("");
	const [polyRestoring, setPolyRestoring] = useState(false);
	useEffect(() => {
		let cancel = false;
		readMainnetSlot().then((slot) => {
			if (!cancel) setMainnetSlot(slot);
		});
		return () => {
			cancel = true;
		};
	}, []);
	useEffect(() => {
		if (!polyAddress || !wallet) return;
		prepareBridgeDeposit(false);
	}, [
		polyAddress,
		wallet,
		prepareBridgeDeposit
	]);
	const funded = autoRun ? (polyPusd ?? 0) >= 1 : solKnown && sol >= .05;
	const botStatus = haltReason ? "стоїть" : pending ? "чекає підтвердження" : working ? "працює" : "стоїть";
	return /* @__PURE__ */ jsxs("section", {
		className: "mx-auto mt-3 max-w-5xl rounded-lg border border-border bg-surface p-3",
		children: [
			/* @__PURE__ */ jsx("h2", {
				className: "text-sm font-medium",
				children: "Гаманці"
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-2 grid gap-2 sm:grid-cols-2",
				children: [/* @__PURE__ */ jsxs("div", {
					className: "rounded-md border border-border p-2",
					children: [
						/* @__PURE__ */ jsx("p", {
							className: "text-xs text-muted",
							children: "Ключ кімнати · Devnet"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-1 break-all font-mono text-xs",
							"data-testid": "wallet-address",
							children: wallet ? wallet.pubkey : "створюю ключ…"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-1 text-sm tabular-nums",
							children: solMiss ? "немає цифри" : solKnown ? `${formatSol(sol)} SOL Devnet` : "читаю Devnet…"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-1 text-sm tabular-nums",
							"data-testid": "room-mainnet",
							children: roomMainnetSol == null ? (roomMainnetSolKnown ? "немає цифри" : "читаю mainnet…") : `${formatSol(roomMainnetSol)} SOL mainnet`
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-1 text-sm tabular-nums",
							"data-testid": "room-usdc",
							children: !roomMainnetUsdcKnown ? "читаю USDC…" : roomMainnetUsdc == null ? "немає цифри" : `${roomMainnetUsdc.toFixed(4)} USDC mainnet`
						}),
						lastLiveSig ? /* @__PURE__ */ jsx("p", {
							className: "mt-1 break-all font-mono text-xs",
							"data-testid": "live-sig",
							children: lastLiveSig
						}) : null
					]
				}), /* @__PURE__ */ jsxs("div", {
					className: "rounded-md border border-border p-2",
					children: [
						/* @__PURE__ */ jsx("p", {
							className: "text-xs text-muted",
							children: "Phantom · не підписує живий своп"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-1 break-all font-mono text-xs",
							"data-testid": "trading-address",
							children: externalWallet ?? "не підключено"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-1 text-sm tabular-nums",
							children: externalWallet ? `${formatSol(externalSol ?? 0)} SOL` : "—"
						})
					]
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-2 rounded-md border border-border p-2",
				"data-testid": "twap-block",
				children: [
					/* @__PURE__ */ jsx("p", {
						className: "text-xs text-muted",
						children: "Chainlink TWAP"
					}),
					/* @__PURE__ */ jsx(TwapRow, {
						label: "btc/usd 30s",
						row: twap?.w30,
						testId: "twap-30"
					}),
					/* @__PURE__ */ jsx(TwapRow, {
						label: "btc/usd 60s",
						row: twap?.w60,
						testId: "twap-60"
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-2 rounded-md border border-border p-2",
				children: [
					/* @__PURE__ */ jsx("p", {
						className: "text-xs text-muted",
						children: "Polygon · Polymarket"
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-1 break-all font-mono text-xs",
						"data-testid": "poly-address",
						children: polyAddress ?? "створюю адресу…"
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-1 break-all font-mono text-xs text-muted",
						"data-testid": "poly-deposit",
						children: polyAddress && deriveDepositWallet(polyAddress) ? `deposit ${deriveDepositWallet(polyAddress)} · контракт створено` : ""
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-1 text-sm tabular-nums",
						"data-testid": "poly-pusd",
						children: !polyKnown ? "читаю…" : polyPusd == null ? "немає цифри" : `${polyPusd.toFixed(4)} pUSD`
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-1 text-sm tabular-nums",
						"data-testid": "poly-pol",
						children: !polyKnown ? "читаю…" : polyPol == null ? "немає цифри" : `${polyPol.toFixed(4)} POL`
					}),
					/* @__PURE__ */ jsxs("p", {
						className: "mt-1 text-xs text-muted leading-normal",
						children: polyHold ? `Відкрита BUY ${polyHold.price} · ${polyHold.shares} акц.` : polyOpenId ? "Є відкритий ордер." : ""
					}),
					polyBooks.length ? /* @__PURE__ */ jsx("ul", {
						className: "mt-1 space-y-1",
						"data-testid": "poly-books",
						children: polyBooks.map((row) => /* @__PURE__ */ jsx("li", {
							className: "break-all font-mono text-xs leading-normal",
							children: `${row.lane === "weather" ? "погода" : "події"} · ${row.orderId}`
						}, row.orderId))
					}) : null,
					lastPolyStatus === "redeem" && lastPolyOrder ? /* @__PURE__ */ jsx("p", {
						className: "mt-1 break-all text-xs leading-normal",
						"data-testid": "poly-redeem-line",
						children: polyKnown && polyPusd != null ? `redeem · ${lastPolyOrder} · ${polyPusd.toFixed(4)} pUSD` : `redeem · ${lastPolyOrder}. Баланс не вигадую.`
					}) : null,
					polyKnown && polyPusd != null && polyPusd < 1 ? /* @__PURE__ */ jsx("p", {
						className: "mt-1 text-xs leading-normal",
						children: "Поповни pUSD. Агент стоїть."
					}) : null,
					lastGrok ? /* @__PURE__ */ jsx("p", {
						className: "mt-1 break-words text-xs leading-normal",
						"data-testid": "last-grok",
						children: `${GROK_MODEL}: ${lastGrok.why}`
					}) : null,
					grokFlight ? /* @__PURE__ */ jsx("p", {
						className: "mt-1 text-xs leading-normal",
						"data-testid": "grok-flight",
						children: "Grok ще відповідає. Нову не ставлю."
					}) : null,
					lastPolyOrder ? /* @__PURE__ */ jsxs("p", {
						className: "mt-1 break-all font-mono text-xs",
						"data-testid": "poly-order",
						children: [lastPolyStatus ? `${lastPolyStatus} · ` : "", lastPolyOrder]
					}) : null,
					/* @__PURE__ */ jsxs("div", {
						className: "mt-2 flex flex-wrap gap-2",
						children: [
							/* @__PURE__ */ jsx(Button, {
								"data-testid": "poly-review-crypto",
								onClick: () => void reviewPoly("crypto"),
								children: "Крипто"
							}),
							/* @__PURE__ */ jsx(Button, {
								"data-testid": "poly-review",
								onClick: () => void reviewPoly("events"),
								children: "Події"
							}),
							/* @__PURE__ */ jsx(Button, {
								"data-testid": "poly-review-weather",
								onClick: () => void reviewPoly("weather"),
								children: "Погода"
							}),
							/* @__PURE__ */ jsx(Button, {
								variant: "ghost",
								onClick: () => {
									if (!polyArm) {
										setPolyArm(true);
										setPolySecret("");
										return;
									}
									revealPolygonSecret().then((value) => setPolySecret(value)).catch(() => useAgents.setState({ notice: "Секрет Polygon не відкрився." }));
								},
								children: polyArm ? "Показати секрет Polygon ще раз" : "Показати секрет Polygon"
							})
						]
					}),
					polySecret ? /* @__PURE__ */ jsxs("label", {
						className: "mt-2 block text-xs text-muted",
						children: ["Секрет Polygon. Скопіюй сам і сховай.", /* @__PURE__ */ jsx("input", {
							className: "mt-1 h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs",
							readOnly: true,
							value: polySecret,
							onFocus: (e) => e.currentTarget.select()
						})]
					}) : null,
					/* @__PURE__ */ jsxs("form", {
						className: "mt-2 flex flex-wrap gap-2",
						onSubmit: (e) => {
							e.preventDefault();
							const value = polyRestore;
							if (!value.trim() || polyRestoring) return;
							setPolyRestoring(true);
							restorePolygonKey(value).finally(() => {
								setPolyRestore("");
								setPolyRestoring(false);
							});
						},
						children: [/* @__PURE__ */ jsx("input", {
							className: "h-11 min-w-[12rem] flex-1 rounded-md border border-border bg-bg px-3 font-mono text-xs",
							type: "password",
							"data-testid": "restore-polygon",
							autoComplete: "off",
							spellCheck: false,
							placeholder: "Вставити секрет Polygon 0x…",
							"aria-label": "Записаний секрет Polygon",
							value: polyRestore,
							onChange: (e) => setPolyRestore(e.target.value)
						}), /* @__PURE__ */ jsx(Button, {
							type: "submit",
							variant: "ghost",
							disabled: polyRestoring || !polyRestore.trim(),
							children: "Повернути Polygon"
						})]
					})
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-2 rounded-md border border-border p-2",
				"data-testid": "bridge-block",
				children: [
					/* @__PURE__ */ jsx("p", {
						className: "text-xs text-muted",
						children: "Депозит у pUSD"
					}),
					/* @__PURE__ */ jsxs("p", {
						className: "mt-1 break-all font-mono text-xs",
						children: [
							polyAddress ?? "створюю адресу…",
							" · ",
							!polyKnown ? "читаю…" : polyPusd == null ? "немає цифри" : `${polyPusd.toFixed(4)} pUSD`,
							" · ",
							!polyKnown ? "читаю…" : polyPol == null ? "немає цифри" : `${polyPol.toFixed(4)} POL`
						]
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-1 break-all font-mono text-xs",
						"data-testid": "bridge-svm",
						children: bridgeSvm ?? (bridgeWhy === "немає адреси моста" ? "немає адреси моста" : "читаю адресу моста…")
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-1 text-xs leading-normal",
						children: "Це не Jupiter. USDC/SOL з кімнати на цю SVM-адресу стає pUSD на Polygon."
					}),
					/* @__PURE__ */ jsxs("p", {
						className: "mt-1 text-xs leading-normal",
						children: [
							"Газ Polygon цим депозитом може не прийти. Кинь трохи POL на ",
							polyAddress ?? "0x…",
							"."
						]
					}),
					bridgeStatus ? /* @__PURE__ */ jsxs("p", {
						className: "mt-1 break-all text-xs",
						"data-testid": "bridge-status",
						children: ["Статус моста: ", bridgeStatus]
					}) : null,
					bridgeWhy && !bridgePlan ? /* @__PURE__ */ jsx("p", {
						className: "mt-1 text-xs leading-normal",
						children: bridgeWhy
					}) : null,
					/* @__PURE__ */ jsx("div", {
						className: "mt-2",
						children: /* @__PURE__ */ jsx(Button, {
							"data-testid": "bridge-prepare",
							disabled: bridgeBusy || !polyAddress,
							onClick: () => void prepareBridgeDeposit(true),
							children: "Депозит"
						})
					}),
					bridgePlan ? /* @__PURE__ */ jsxs("div", {
						className: "mt-2 rounded-md border border-accent p-2",
						"data-testid": "bridge-card",
						children: [
							/* @__PURE__ */ jsx("p", {
								className: "text-sm font-medium",
								children: "Депозит Polymarket Bridge. Solana → pUSD на Polygon"
							}),
							/* @__PURE__ */ jsx("p", {
								className: "mt-1 text-sm",
								children: bridgePlan.asset === "USDC" ? "USDC кімнати" : bridgePlan.asset === "SOL" ? "SOL кімнати" : "актив не обрано"
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "mt-1 text-sm tabular-nums",
								children: [bridgePlan.amount == null ? "сума немає" : `${bridgePlan.amount} ${bridgePlan.asset ?? ""}`, bridgePlan.minUsd == null ? " · невідомий мінімум" : ` · мінімум ${bridgePlan.minUsd} USD`]
							}),
							/* @__PURE__ */ jsx("p", {
								className: "mt-1 break-all font-mono text-xs",
								children: bridgePlan.svm
							}),
							/* @__PURE__ */ jsx("p", {
								className: "mt-1 break-all font-mono text-xs",
								children: bridgePlan.polygon
							}),
							bridgePlan.why ? /* @__PURE__ */ jsx("p", {
								className: "mt-1 text-xs leading-normal",
								children: bridgePlan.why
							}) : null,
							/* @__PURE__ */ jsxs("div", {
								className: "mt-2 flex flex-wrap gap-2",
								children: [bridgePlan.canConfirm ? /* @__PURE__ */ jsx(Button, {
									"data-testid": "bridge-confirm",
									disabled: bridgeBusy,
									onClick: () => void useAgents.getState().confirmBridge(),
									children: "Підтвердити"
								}) : null, /* @__PURE__ */ jsx(Button, {
									variant: "ghost",
									"data-testid": "bridge-cancel",
									disabled: bridgeBusy,
									onClick: () => useAgents.getState().rejectBridge(),
									children: "Скасувати"
								})]
							})
						]
					}) : null
				]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-2 text-xs text-muted leading-normal",
				children: `Пісочниця. Це тестовий переказ Devnet. Мейннет лише читання${mainnetSlot != null ? `, слот ${mainnetSlot}, вузол живий` : ""}.`
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-xs text-muted leading-normal",
				children: "Кнопка «Поповнити» — лише кран Devnet."
			}),
			(liveArmed || liveAck) && !secretSeen ? /* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs leading-normal",
				children: "Запиши секрет ключа, потім надсилай mainnet SOL на цю адресу."
			}) : null,
			/* @__PURE__ */ jsxs("div", {
				className: "mt-2 flex flex-col gap-1 text-xs",
				children: [
					/* @__PURE__ */ jsxs("label", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ jsx("input", {
							type: "checkbox",
							"data-testid": "live-arm",
							checked: liveArmed,
							onChange: (e) => setLiveArmed(e.target.checked)
						}), "Дрібні живі угоди"]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ jsx("input", {
							type: "checkbox",
							"data-testid": "live-ack",
							checked: liveAck,
							disabled: !liveArmed,
							onChange: (e) => setLiveAck(e.target.checked)
						}), "Розумію, що це живий SOL"]
					}),
					/* @__PURE__ */ jsxs("label", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ jsx("input", {
							type: "checkbox",
							"data-testid": "auto-run",
							checked: autoRun,
							onChange: (e) => setAutoRun(e.target.checked)
						}), "Агент працює сам у межах лімітів"]
					})
				]
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-xs leading-normal",
				"data-testid": "bot-status",
				children: [
					"Боти: ",
					botStatus,
					".",
					!funded ? " Поповни гаманець. Боти стоять." : "",
					`${lossStreak > 0 ? ` Мінусів підряд: ${lossStreak}.` : ""} Сесія ${sessionSpent.toFixed(2)}/0.20 · доба ${daySpent.toFixed(2)}/0.30.`
				]
			}),
			haltReason ? /* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs",
				children: haltReason
			}) : null,
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs text-muted leading-normal",
				children: "Без запису секрету ключ зникне разом із браузером. Секрет не йде на сервер."
			}),
			/* @__PURE__ */ jsxs("form", {
				className: "mt-2 flex flex-wrap gap-2",
				onSubmit: (e) => {
					e.preventDefault();
					const value = restore;
					if (!value.trim() || restoring) return;
					setRestoring(true);
					restoreRoomKey(value).finally(() => {
						setRestore("");
						setRestoring(false);
					});
				},
				children: [/* @__PURE__ */ jsx("input", {
					className: "h-11 min-w-[12rem] flex-1 rounded-md border border-border bg-bg px-3 font-mono text-xs",
					type: "password",
					"data-testid": "restore-secret",
					autoComplete: "off",
					spellCheck: false,
					placeholder: "Вставити записаний секрет ключа",
					"aria-label": "Записаний секрет ключа кімнати",
					value: restore,
					onChange: (e) => setRestore(e.target.value)
				}), /* @__PURE__ */ jsx(Button, {
					type: "submit",
					variant: "ghost",
					disabled: restoring || !restore.trim(),
					children: "Повернути ключ"
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-3 flex flex-wrap gap-2",
				children: [
					/* @__PURE__ */ jsx(Button, {
						variant: "ghost",
						"data-testid": "connect-phantom",
						onClick: () => {
							const provider = window.solana;
							const sign = provider?.signAndSendTransaction;
							if (!provider?.isPhantom || !sign) {
								useAgents.setState({ notice: "Phantom у цьому вікні немає. На Android гаманець Solana відкривається в Chrome. Фейковий конект не ставлю." });
								return;
							}
							provider.connect().then(async (res) => {
								const pk = res.publicKey.toString();
								const bal = await readMainnetBalance({ data: { owner: pk } });
								setExternalWallet(pk, bal);
								useAgents.setState({ notice: bal != null && bal < .01 ? "Поповни торговий гаманець. Боти стоять." : "Торговий гаманець підключено. Живий режим ще вимкнений." });
							});
						},
						children: externalWallet ? "Phantom підключено" : "Підключити Phantom"
					}),
					/* @__PURE__ */ jsx(Button, {
						variant: "ghost",
						"data-testid": "reveal-secret",
						onClick: () => {
							if (!secretArm) {
								setSecretArm(true);
								setSecret("");
								return;
							}
							revealRoomSecret().then((value) => {
								setSecret(value);
								markSecretSeen();
							}).catch(() => useAgents.setState({ notice: "Секрет не відкрився." }));
						},
						children: secretArm ? "Показати секрет ще раз" : "Показати секрет"
					}),
					/* @__PURE__ */ jsx("input", {
						className: "h-11 w-28 rounded-md border border-border bg-bg px-3 text-sm tabular-nums",
						"data-testid": "deposit-amount",
						inputMode: "decimal",
						"aria-label": "Сума поповнення в SOL",
						value: topup,
						onChange: (e) => setTopup(e.target.value)
					}),
					/* @__PURE__ */ jsx(Button, {
						"data-testid": "deposit-sol",
						disabled: !wallet || chainBusy,
						onClick: () => void deposit(Number(topup.replace(",", "."))),
						children: "Поповнити"
					}),
					/* @__PURE__ */ jsx("input", {
						className: "h-11 min-w-[12rem] flex-1 rounded-md border border-border bg-bg px-3 text-sm",
						"data-testid": "withdraw-to",
						placeholder: "Адреса отримувача",
						value: to,
						onChange: (e) => setTo(e.target.value),
						autoComplete: "off",
						spellCheck: false
					}),
					/* @__PURE__ */ jsx("input", {
						className: "h-11 w-28 rounded-md border border-border bg-bg px-3 text-sm tabular-nums",
						"data-testid": "withdraw-amount",
						inputMode: "decimal",
						"aria-label": "Сума виводу в SOL",
						value: amount,
						onChange: (e) => setAmount(e.target.value)
					}),
					/* @__PURE__ */ jsx(Button, {
						variant: "ghost",
						"data-testid": "withdraw-sol",
						disabled: !wallet || chainBusy,
						onClick: () => void withdraw(to, Number(amount.replace(",", "."))),
						children: "Вивести Devnet"
					}),
					/* @__PURE__ */ jsx(Button, {
						variant: "ghost",
						"data-testid": "withdraw-agent",
						disabled: !wallet || chainBusy,
						onClick: () => void useAgents.getState().withdrawMainnet(to, Number(amount.replace(",", "."))),
						children: "Вивести SOL агента"
					}),
					/* @__PURE__ */ jsx("input", {
						className: "h-11 min-w-[12rem] flex-1 rounded-md border border-border bg-bg px-3 text-sm",
						"data-testid": "withdraw-pusd-to",
						placeholder: "Адреса Polygon 0x…",
						value: polyTo,
						onChange: (e) => setPolyTo(e.target.value),
						autoComplete: "off",
						spellCheck: false
					}),
					/* @__PURE__ */ jsx(Button, {
						variant: "ghost",
						"data-testid": "withdraw-pusd",
						disabled: chainBusy,
						onClick: () => void useAgents.getState().withdrawPusd(polyTo, Number(amount.replace(",", "."))),
						children: "Вивести pUSD Polymarket"
					})
				]
			}),
			secret ? /* @__PURE__ */ jsxs("label", {
				className: "mt-3 block text-xs text-muted",
				children: ["Секрет ключа кімнати. Скопіюй сам і сховай.", /* @__PURE__ */ jsx("input", {
					className: "mt-1 h-11 w-full rounded-md border border-border bg-bg px-3 font-mono text-xs",
					readOnly: true,
					value: secret,
					"data-testid": "room-secret",
					onFocus: (e) => e.currentTarget.select()
				})]
			}) : secretArm ? /* @__PURE__ */ jsx("p", {
				className: "mt-2 text-xs",
				children: "Натисни «Показати секрет ще раз». Після цього він з’явиться лише тут."
			}) : null
		]
	});
}
function PolyGate() {
	const ticket = useAgents((s) => s.polyTicket);
	const address = useAgents((s) => s.polyAddress);
	const busy = useAgents((s) => s.polyBusy);
	const confirm = useAgents((s) => s.confirmPoly);
	const reject = useAgents((s) => s.rejectPoly);
	if (!ticket || ticket.model !== GROK_MODEL || ticket.confidence < .65) return null;
	if (ticket.action !== "yes" && ticket.action !== "no" && ticket.action !== "sell") return null;
	return /* @__PURE__ */ jsxs("section", {
		className: "mx-auto mt-3 max-w-5xl rounded-lg border border-accent bg-surface p-3",
		"data-testid": "poly-gate",
		children: [
			/* @__PURE__ */ jsx("h2", {
				className: "text-sm font-medium",
				children: "Живий ордер Polymarket CLOB на Polygon"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-sm",
				children: ticket.lane === "crypto" ? "Крипто-бот" : ticket.lane === "weather" ? "Погода" : "Бот подій"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-sm",
				children: ticket.question
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 break-all text-xs text-muted",
				children: [
					ticket.outcome,
					" · ",
					ticket.tokenId
				]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-sm",
				children: ticket.side === "SELL" ? "SELL" : "BUY"
			}),
			ticket.side === "SELL" ? /* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-sm tabular-nums",
				children: [
					ticket.shares,
					" акц. · bid ",
					ticket.price,
					ticket.entryPrice ? ` · вхід ${ticket.entryPrice}` : ""
				]
			}) : /* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-sm tabular-nums",
				children: [
					ticket.spend,
					" pUSD · ціна входу ",
					ticket.price
				]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs text-muted",
				children: ticket.category
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-xs text-muted",
				children: ["Резолв: ", ticket.endLabel]
			}),
			ticket.priceToBeat != null && ticket.currentRef != null ? /* @__PURE__ */ jsxs("p", {
				className: "mt-1 break-words text-xs leading-normal",
				"data-testid": "poly-anchor",
				children: [
					ticket.windowLabel ? `вікно ${ticket.windowLabel} · ` : "",
					"price to beat ",
					ticket.priceToBeat.toFixed(2),
					" · current TWAP ",
					ticket.currentRef.toFixed(2),
					" · дельта",
					" ",
					ticket.delta == null ? "немає" : ticket.delta.toFixed(2),
					ticket.secondsLeft == null ? "" : ` · ${ticket.secondsLeft} с до резолву`,
					ticket.windowLabel ? ` · резолв TWAP ${ticket.windowLabel === "5m" ? "30s" : "60s"}` : ""
				]
			}) : null,
			ticket.lane === "crypto" ? /* @__PURE__ */ jsx("p", {
				className: "mt-1 break-words text-xs leading-normal",
				"data-testid": "poly-twap",
				children: ticket.twapLine ?? "TWAP 30s немає цифри / 60s немає цифри"
			}) : null,
			ticket.lane === "weather" ? /* @__PURE__ */ jsx("p", {
				className: "mt-1 break-words text-xs leading-normal",
				"data-testid": "poly-station",
				children: `станція ${ticket.station || "немає"} · forecast ${ticket.forecastHigh == null ? "немає" : ticket.forecastHigh.toFixed(1) + "°" + (ticket.tempUnit || "")} · observed ${ticket.observedHigh == null ? "немає" : ticket.observedHigh.toFixed(1) + "°" + (ticket.tempUnit || "")}`
			}) : null,
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs text-muted",
				children: ticket.feeLabel
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs text-muted",
				children: "Мережа: Polygon"
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 break-all text-xs text-muted",
				children: ["Адреса: ", address]
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-xs",
				"data-testid": "poly-grok",
				children: [
					GROK_MODEL + " · ",
					Math.round(ticket.confidence * 100),
					"% · ",
					(ticket.grokMs / 1e3).toFixed(1),
					" с"
				]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs leading-normal",
				children: ticket.why
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-3 flex flex-wrap gap-2",
				children: [/* @__PURE__ */ jsx(Button, {
					"data-testid": "poly-confirm",
					disabled: busy,
					onClick: () => void confirm(),
					children: "Підтвердити"
				}), /* @__PURE__ */ jsx(Button, {
					variant: "ghost",
					"data-testid": "poly-reject",
					disabled: busy,
					onClick: reject,
					children: "Скасувати"
				})]
			})
		]
	});
}
function PolyCancelGate() {
	const card = useAgents((s) => s.polyCancel);
	const busy = useAgents((s) => s.polyBusy);
	const confirm = useAgents((s) => s.confirmPolyCancel);
	const reject = useAgents((s) => s.rejectPolyCancel);
	if (!card) return null;
	return /* @__PURE__ */ jsxs("section", {
		className: "mx-auto mt-3 max-w-5xl rounded-lg border border-accent bg-surface p-3",
		"data-testid": "poly-cancel-gate",
		children: [
			/* @__PURE__ */ jsx("h2", {
				className: "text-sm font-medium",
				children: "Скасувати ордер у стакані"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-sm",
				children: "Live, ще без fill. Продажу акцій немає."
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 break-all font-mono text-xs",
				children: card.orderId
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs text-muted",
				children: "Мережа: Polygon"
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-3 flex flex-wrap gap-2",
				children: [/* @__PURE__ */ jsx(Button, {
					"data-testid": "poly-cancel-confirm",
					disabled: busy,
					onClick: () => void confirm(),
					children: "Підтвердити"
				}), /* @__PURE__ */ jsx(Button, {
					variant: "ghost",
					"data-testid": "poly-cancel-reject",
					disabled: busy,
					onClick: reject,
					children: "Скасувати"
				})]
			})
		]
	});
}
function PolyRedeemGate() {
	const card = useAgents((s) => s.polyRedeem);
	const address = useAgents((s) => s.polyAddress);
	const busy = useAgents((s) => s.polyBusy);
	const confirm = useAgents((s) => s.confirmRedeem);
	const reject = useAgents((s) => s.rejectRedeem);
	if (!card) return null;
	return /* @__PURE__ */ jsxs("section", {
		className: "mx-auto mt-3 max-w-5xl rounded-lg border border-accent bg-surface p-3",
		"data-testid": "poly-redeem-gate",
		children: [
			/* @__PURE__ */ jsx("h2", {
				className: "text-sm font-medium",
				children: "Погасити виграш"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 break-all font-mono text-xs",
				children: card.tokenId
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 break-all font-mono text-xs",
				children: card.conditionId
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs text-muted",
				children: "Мережа: Polygon"
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 break-all text-xs text-muted",
				children: ["Адреса: ", address]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs leading-normal",
				children: "Суму виграшу не показую, поки мережа не віддасть новий pUSD."
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-3 flex flex-wrap gap-2",
				children: [/* @__PURE__ */ jsx(Button, {
					"data-testid": "poly-redeem-confirm",
					disabled: busy,
					onClick: () => void confirm(),
					children: "Підтвердити"
				}), /* @__PURE__ */ jsx(Button, {
					variant: "ghost",
					"data-testid": "poly-redeem-reject",
					disabled: busy,
					onClick: reject,
					children: "Скасувати"
				})]
			})
		]
	});
}
function TradeGate() {
	const pending = useAgents((s) => s.pendingTrade);
	const cap = useAgents((s) => s.sessionCapSol);
	const spent = useAgents((s) => s.sessionSpent);
	const external = useAgents((s) => s.externalWallet);
	const confirm = useAgents((s) => s.confirmTrade);
	const reject = useAgents((s) => s.rejectTrade);
	const setLiveQuoteUsdc = useAgents((s) => s.setLiveQuoteUsdc);
	const [quote, setQuote] = useState("");
	const [liveOut, setLiveOut] = useState(null);
	const [liveMiss, setLiveMiss] = useState(false);
	useEffect(() => {
		setQuote("");
		setLiveOut(null);
		setLiveMiss(false);
		setLiveQuoteUsdc(null);
		if (!pending || pending.kind !== "dex") return;
		let cancel = false;
		quoteJupiter({ data: { sol: pending.amount } }).then((res) => {
			if (cancel) return;
			if (pending.live) {
				if (res.ok) {
					setLiveOut(res.outUsdc);
					setLiveQuoteUsdc(res.outUsdc);
				} else {
					setLiveMiss(true);
					setLiveQuoteUsdc(null);
					useAgents.setState({ notice: "Jupiter не відповів" });
				}
				return;
			}
			setQuote(res.ok ? `Jupiter (лише читання): близько ${res.outUsdc.toFixed(2)} USDC за ${res.inSol} SOL.` : "Jupiter не відповів");
		});
		return () => {
			cancel = true;
		};
	}, [pending, setLiveQuoteUsdc]);
	if (!pending) return null;
	if (pending.live) return /* @__PURE__ */ jsxs("section", {
		className: "mx-auto mt-3 max-w-5xl rounded-lg border border-accent bg-surface p-3",
		"data-testid": "trade-gate",
		children: [
			/* @__PURE__ */ jsx("h2", {
				className: "text-sm font-medium",
				children: "Живий своп Jupiter на mainnet"
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-sm tabular-nums",
				children: [
					"Сума in: ",
					pending.amount,
					" SOL"
				]
			}),
			liveOut != null ? /* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-sm tabular-nums",
				children: ["Очікуваний USDC: ", liveOut.toFixed(2)]
			}) : /* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs",
				children: liveMiss ? "Jupiter не відповів" : "читаю котирування…"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs text-muted",
				children: "Мережа: Mainnet"
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 break-all text-xs text-muted",
				children: ["Адреса кімнати: ", pending.from]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mt-3 flex flex-wrap gap-2",
				children: [liveOut != null ? /* @__PURE__ */ jsx(Button, {
					"data-testid": "confirm-trade",
					onClick: confirm,
					children: "Підтвердити"
				}) : null, /* @__PURE__ */ jsx(Button, {
					variant: "ghost",
					"data-testid": "reject-trade",
					onClick: reject,
					children: "Скасувати"
				})]
			})
		]
	});
	return /* @__PURE__ */ jsxs("section", {
		className: "mx-auto mt-3 max-w-5xl rounded-lg border border-accent bg-surface p-3",
		"data-testid": "trade-gate",
		children: [
			/* @__PURE__ */ jsx("h2", {
				className: "text-sm font-medium",
				children: "Підтверди угоду"
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-sm",
				children: pending.title
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-sm tabular-nums",
				children: pending.detail
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-xs text-muted",
				children: ["Мережа: ", pending.network]
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 break-all text-xs text-muted",
				children: ["З гаманця: ", pending.from]
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 break-all text-xs text-muted",
				children: ["Куди: ", pending.to]
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs leading-normal",
				children: pending.honest
			}),
			/* @__PURE__ */ jsxs("p", {
				className: "mt-1 text-xs text-muted",
				children: [
					"Ліміт сесії ",
					spent.toFixed(2),
					" / ",
					cap.toFixed(2),
					" SOL. Торговий гаманець:",
					" ",
					external ? `${external.slice(0, 4)}…${external.slice(-4)}` : "не підключено",
					". Списує ключ кімнати на Devnet."
				]
			}),
			quote ? /* @__PURE__ */ jsx("p", {
				className: "mt-1 text-xs text-muted",
				children: quote
			}) : null,
			/* @__PURE__ */ jsxs("div", {
				className: "mt-3 flex flex-wrap gap-2",
				children: [/* @__PURE__ */ jsx(Button, {
					"data-testid": "confirm-trade",
					onClick: confirm,
					children: "Підтвердити"
				}), /* @__PURE__ */ jsx(Button, {
					variant: "ghost",
					"data-testid": "reject-trade",
					onClick: reject,
					children: "Скасувати"
				})]
			})
		]
	});
}
function RoomPanel() {
	const nfts = useAgents((s) => s.nfts);
	const wallet = useAgents((s) => s.wallet);
	const agents = useAgents((s) => s.agents);
	const setTab = useAgents((s) => s.setTab);
	return /* @__PURE__ */ jsxs("section", {
		className: "flex flex-col gap-4",
		children: [
			/* @__PURE__ */ jsx("p", {
				className: "max-w-xl text-sm text-muted leading-normal",
				children: "Гаманець створюється з першого заходу. Біткоїн-бот ставить на 15 хв Up/Down. Події і погода — окремі смуги. У Праці в кожного є огляд і ціль."
			}),
			/* @__PURE__ */ jsx("div", {
				className: "grid gap-3",
				children: /* @__PURE__ */ jsxs("button", {
					type: "button",
					onClick: () => setTab("store"),
					className: "rounded-lg border border-border bg-surface p-4 text-left",
					children: [
						/* @__PURE__ */ jsx("div", {
							className: "text-xs uppercase tracking-wide text-muted",
							children: "Store"
						}),
						/* @__PURE__ */ jsx("h2", {
							className: "mt-1 font-medium",
							children: "Готовий агент"
						}),
						/* @__PURE__ */ jsx("p", {
							className: "mt-1 text-sm text-muted leading-normal",
							children: "Купуєте NFT і одразу тиснете Work. Ставки йдуть тестовим SOL цього гаманця."
						})
					]
				})
			}),
			/* @__PURE__ */ jsx("div", {
				className: "grid grid-cols-3 gap-3",
				children: CLASS_IDS.map((id) => {
					const meta = CLASS_META[id];
					const owned = nfts.filter((n) => n.classId === id).length;
					return /* @__PURE__ */ jsxs("div", {
						className: "rounded-lg border border-border bg-surface p-3",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "text-xs text-muted",
								children: ["Клас ", id]
							}),
							/* @__PURE__ */ jsx("div", {
								className: "mt-1 font-medium text-sm",
								children: meta.short
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "mt-2 font-mono text-xs tabular-nums text-muted",
								children: [owned, " NFT"]
							})
						]
					}, id);
				})
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "rounded-xl border border-border bg-surface p-4",
				children: [
					/* @__PURE__ */ jsx("h2", {
						className: "text-sm font-medium",
						children: "Станція"
					}),
					/* @__PURE__ */ jsx("p", {
						className: "mt-1 text-sm text-muted",
						children: wallet ? `Ключ ${shortKey(wallet.pubkey, 6, 6)} уже на цьому пристрої. Поповнення і вивід — у шапці.` : "Створюю ключ на цьому пристрої…"
					}),
					/* @__PURE__ */ jsx("ul", {
						className: "mt-3 space-y-1.5 text-sm text-muted",
						children: ["prediction"].map((k) => /* @__PURE__ */ jsxs("li", {
							className: "flex justify-between gap-3",
							children: [/* @__PURE__ */ jsx("span", {
								className: "capitalize",
								children: k
							}), /* @__PURE__ */ jsx("span", {
								className: "text-fg",
								children: agents[k].status
							})]
						}, k))
					}),
					/* @__PURE__ */ jsx(Button, {
						className: "mt-4 w-full",
						onClick: () => setTab("work"),
						children: "Відкрити Працю"
					})
				]
			})
		]
	});
}
function WorkPanel() {
	const nfts = useAgents((s) => s.nfts);
	const wallet = useAgents((s) => s.wallet);
	const agents = useAgents((s) => s.agents);
	const working = useAgents((s) => s.working);
	const pressWork = useAgents((s) => s.pressWork);
	const stopWork = useAgents((s) => s.stopWork);
	const listForSale = useAgents((s) => s.listForSale);
	const setTab = useAgents((s) => s.setTab);
	const log = useAgents((s) => s.log);
	const ownedAll = wallet ? nfts.filter((n) => n.owner === wallet.pubkey) : [];
	const owned = ownedAll;
	return /* @__PURE__ */ jsxs("section", {
		className: "flex flex-col gap-5",
		children: [
			/* @__PURE__ */ jsx("div", {
				className: "rounded-xl border border-border bg-surface p-4 sm:p-5",
				children: /* @__PURE__ */ jsxs("div", {
					className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
					children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", {
						className: "font-display text-xl leading-tight",
						children: "Праця"
					}), /* @__PURE__ */ jsx("p", {
						className: "mt-1 max-w-lg text-sm text-muted leading-normal",
						children: "Тут агент працює сам, у межах лімітів. Немає агента — візьми його в Магазині."
					})] }), working ? /* @__PURE__ */ jsxs(Button, {
						variant: "ghost",
						size: "lg",
						"data-testid": "work-toggle",
						onClick: stopWork,
						className: "sm:min-w-44",
						children: [/* @__PURE__ */ jsx(IconStop, { size: 16 }), "Стоп"]
					}) : /* @__PURE__ */ jsxs(Button, {
						size: "lg",
						"data-testid": "work-toggle",
						onClick: () => void pressWork(),
						className: "sm:min-w-44",
						children: [/* @__PURE__ */ jsx(IconPlay, { size: 16 }), "Запустити"]
					})]
				})
			}),
			owned.length > 0 ? /* @__PURE__ */ jsx(AgentConsole, { owned }) : null,
			/* @__PURE__ */ jsx("div", {
				className: "grid gap-3 md:grid-cols-2",
				children: ["prediction", "dex"].map((kind) => {
					const rt = agents[kind];
					const nft = owned.find((n) => n.asset === rt.sourceAsset) ?? null;
					return /* @__PURE__ */ jsx(AgentBay, {
						runtime: rt,
						nft
					}, kind);
				})
			}),
			owned.length === 0 ? /* @__PURE__ */ jsxs("div", {
				className: "rounded-lg border border-dashed border-border p-5",
				children: [/* @__PURE__ */ jsx("p", {
					className: "text-sm text-muted",
					children: "Немає агента. Купіть готового в Магазині."
				}), /* @__PURE__ */ jsx(Button, {
					className: "mt-3",
					onClick: () => setTab("store"),
					children: "Відкрити магазин"
				})]
			}) : /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", {
				className: "text-sm font-medium",
				children: "Мої токени"
			}), /* @__PURE__ */ jsx("ul", {
				className: "mt-3 flex flex-col gap-2",
				children: owned.map((nft) => /* @__PURE__ */ jsx(OwnedRow, {
					nft,
					onList: () => listForSale(nft.asset)
				}, nft.asset))
			})] }),
			/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", {
				className: "text-sm font-medium",
				children: "Журнал"
			}), /* @__PURE__ */ jsx("ul", {
				className: "mt-2 max-h-56 overflow-y-auto rounded-lg border border-border bg-elevated divide-y divide-border",
				children: log.length === 0 ? /* @__PURE__ */ jsx("li", {
					className: "px-3 py-4 text-sm text-muted",
					children: "Поки тихо. Натисніть Work."
				}) : [...log].reverse().slice(0, 24).map((e) => /* @__PURE__ */ jsxs("li", {
					className: "px-3 py-2 text-xs leading-snug",
					children: [/* @__PURE__ */ jsx("span", {
						className: "text-muted font-mono tabular-nums",
						children: new Date(e.at).toLocaleTimeString("uk-UA", {
							hour: "2-digit",
							minute: "2-digit",
							second: "2-digit"
						})
					}), /* @__PURE__ */ jsx("span", {
						className: "ml-2 text-fg",
						children: e.text
					})]
				}, e.id))
			})] })
		]
	});
}
function OwnedRow({ nft, onList }) {
	const gate = listEligible(nft);
	const price = quoteResaleSol(nft);
	return /* @__PURE__ */ jsxs("li", {
		className: "rounded-lg border border-border bg-elevated p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "min-w-0",
			children: [
				/* @__PURE__ */ jsx("div", {
					className: "text-sm font-medium",
					children: nft.name
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "text-xs text-muted font-mono",
					children: [
						CLASS_META[nft.classId].title,
						" · ",
						nft.asset.slice(0, 4),
						"…",
						nft.asset.slice(-4),
						" · XP ",
						nft.metrics.xp,
						" · PnL ",
						nft.metrics.pnlSol.toFixed(3)
					]
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-1 text-xs text-muted break-words",
					children: `${workLabel(nft)} · APR ${aprLabel(nft)}`
				}),
				!gate.ok ? /* @__PURE__ */ jsx("p", {
					className: "mt-1 text-xs text-muted",
					children: gate.reason
				}) : null
			]
		}), /* @__PURE__ */ jsxs(Button, {
			variant: "ghost",
			size: "sm",
			disabled: !gate.ok,
			onClick: onList,
			children: [
				"Виставити · ",
				price.toFixed(2),
				" SOL"
			]
		})]
	});
}
function StorePanel() {
	const listings = useAgents((s) => s.listings);
	const buyListing = useAgents((s) => s.buyListing);
	const buyLiveSku = useAgents((s) => s.buyLiveSku);
	const ensureWallet = useAgents((s) => s.ensureWallet);
	const setTab = useAgents((s) => s.setTab);
	const sol = useAgents((s) => s.sol);
	const solKnown = useAgents((s) => s.solKnown);
	const solMiss = useAgents((s) => s.solMiss);
	const roomMainnetSol = useAgents((s) => s.roomMainnetSol);
	const roomMainnetSolKnown = useAgents((s) => s.roomMainnetSolKnown);
	const [lane, setLane] = useState("live");
	useEffect(() => {
		ensureWallet();
	}, [ensureWallet]);
	const skus = liveCatalog();
	return /* @__PURE__ */ jsxs("section", {
		className: "flex flex-col gap-5",
		children: [
			/* @__PURE__ */ jsxs("div", { children: [
				/* @__PURE__ */ jsx("h2", {
					className: "font-display text-xl leading-tight",
					children: "Store"
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-1 max-w-xl text-sm text-muted leading-normal",
					children: "Готовий агент одразу в роботу. Вторинка — токени, які вже виставили."
				}),
				/* @__PURE__ */ jsxs("p", {
					className: "mt-2 text-sm tabular-nums",
					"data-testid": "store-devnet",
					children: ["Devnet: ", solMiss ? "немає цифри" : !solKnown ? "читаю…" : `${formatSol(sol)} SOL`]
				}),
				/* @__PURE__ */ jsxs("p", {
					className: "text-sm tabular-nums",
					"data-testid": "store-mainnet",
					children: ["mainnet: ", roomMainnetSol == null ? (roomMainnetSolKnown ? "немає цифри" : "читаю…") : `${formatSol(roomMainnetSol)} SOL`]
				}),
				/* @__PURE__ */ jsx("p", {
					className: "mt-1 text-xs text-muted leading-normal",
					children: "Комісія мінту — Devnet. Mainnet сюди не йде."
				})
			] }),
			/* @__PURE__ */ jsx("div", {
				className: "grid grid-cols-2 gap-1 rounded-md border border-border bg-elevated p-1",
				children: [["live", "Агенти"], ["resale", "Вторинка"]].map(([id, label]) => /* @__PURE__ */ jsx("button", {
					type: "button",
					"data-testid": `lane-${id}`,
					onClick: () => setLane(id),
					className: cn("h-10 rounded-sm text-sm font-medium", lane === id ? "bg-surface text-fg" : "text-muted"),
					children: label
				}, id))
			}),
			lane === "live" ? /* @__PURE__ */ jsx("ul", {
				className: "grid gap-3",
				children: skus.map((sku) => /* @__PURE__ */ jsxs("li", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "flex items-start justify-between gap-3",
							children: [/* @__PURE__ */ jsxs("div", { children: [
								/* @__PURE__ */ jsxs("div", {
									className: "text-xs text-muted",
									children: ["Клас ", sku.nft.classId]
								}),
								/* @__PURE__ */ jsx("h3", {
									className: "font-medium",
									children: sku.nft.name
								}),
								/* @__PURE__ */ jsx("p", {
									className: "mt-1 text-sm text-muted",
									children: sku.blurb
								})
							] }), /* @__PURE__ */ jsxs("div", {
								className: "text-right text-sm",
								children: [/* @__PURE__ */ jsx("div", {
									className: "font-medium",
									children: "безкоштовно"
								}), /* @__PURE__ */ jsx("div", {
									className: "text-xs text-muted",
									children: "лише комісія мережі"
								})]
							})]
						}),
						/* @__PURE__ */ jsx(StrategyPeek, {
							nftClass: sku.nft.classId,
							strategy: sku.nft.strategy
						}),
						/* @__PURE__ */ jsx(Button, {
							className: "mt-3 w-full",
							"data-testid": `buy-${sku.id}`,
							onClick: () => void buyLiveSku(sku.id).then((ok) => {
								if (!ok) return;
								useAgents.getState().setTrack("live");
								setTab("work");
							}),
							children: "Взяти і працювати"
						})
					]
				}, sku.id))
			}) : null,
			lane === "resale" ? listings.length === 0 ? /* @__PURE__ */ jsx("p", {
				className: "rounded-lg border border-dashed border-border p-6 text-sm text-muted",
				children: "Ринок порожній. Виставте свого агента з Праці."
			}) : /* @__PURE__ */ jsx("ul", {
				className: "grid gap-3",
				children: listings.map((l) => /* @__PURE__ */ jsxs("li", {
					className: "rounded-xl border border-border bg-surface p-4",
					children: [
						/* @__PURE__ */ jsxs("div", {
							className: "flex items-start justify-between gap-3",
							children: [/* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h3", {
								className: "font-medium",
								children: l.nft.name
							}), /* @__PURE__ */ jsxs("p", {
								className: "text-xs text-muted mt-1",
								children: [
									CLASS_META[l.nft.classId].title,
									" · XP ",
									l.nft.metrics.xp,
									" · jobs",
									" ",
									l.nft.metrics.jobs,
									" · PnL ",
									l.nft.metrics.pnlSol.toFixed(3),
									" SOL"
								]
							})] }), /* @__PURE__ */ jsxs("div", {
								className: "font-mono tabular-nums text-sm",
								children: [l.priceSol.toFixed(2), " SOL"]
							})]
						}),
						/* @__PURE__ */ jsx(StrategyPeek, {
							nftClass: l.nft.classId,
							strategy: l.nft.strategy
						}),
						/* @__PURE__ */ jsx(Button, {
							className: "mt-3 w-full",
							"data-testid": `buy-${l.id}`,
							onClick: () => buyListing(l.id),
							children: "Купити з стратегією"
						})
					]
				}, l.id))
			}) : null
		]
	});
}
function StrategyPeek({ nftClass, strategy }) {
	const lanes = lanesForStrategy(strategy.prediction, nftClass);
	const bits = lanes.map((lane) => {
		const on = laneEnabledOn(strategy.prediction, lane, nftClass);
		const flag = on ? "увімк" : "вимк";
		if (lane === "crypto") return `Крипто 15хв ${flag}`;
		if (lane === "events") return `Події ${eventsDaysOf(strategy.prediction)}д ${flag}`;
		return `Погода ${flag}`;
	});
	return /* @__PURE__ */ jsx("p", {
		className: "mt-2 text-xs text-muted break-words",
		children: bits.join(" · ")
	});
}
export { WorkApp };
