"use client";

import Loading from "@/app/loading";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useKickChat } from "@/hooks/use-kick-chat";
import { useLiveStatus } from "@/hooks/use-live-status";
import { useModeration } from "@/hooks/use-moderation";
import { useQueue } from "@/hooks/use-queue";
import { useSettings } from "@/hooks/use-settings";
import { logger } from "@/lib/utils";
import type { QueuePlayer } from "@/types";
import {
  Crosshair,
  Dices,
  ListOrdered,
  Shield,
  Shuffle,
  Sparkles,
  Swords,
  Trash2,
  UserPlus,
} from "lucide-react";
import { useSession } from "next-auth/react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { GlobalContextMenu } from "./global-context-menu";
import { Header } from "./header";
import { ModerationActionDialog } from "./moderation-action-dialog";
import { ModerationPanel } from "./moderation-panel";
import { QueueTable } from "./queue-table";

import { TeamDisplay } from "./team-display";
import { Watermark } from "./watermark";
const SinglePickDialog = dynamic(
  () => import("./single-pick-dialog").then((m) => m.SinglePickDialog),
  { ssr: false },
);
const ManualAddDialog = dynamic(
  () => import("./manual-add-dialog").then((m) => m.ManualAddDialog),
  { ssr: false },
);
const EditPlayerDialog = dynamic(
  () => import("./edit-player-dialog").then((m) => m.EditPlayerDialog),
  { ssr: false },
);

import { useRouter } from "next/navigation";

export function Dashboard() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const {
    settings,
    updateSettings,
    isConfigured,
    isLoading: settingsLoading,
  } = useSettings();
  const moderation = useModeration();

  // Toast helper that respects the enableToasts setting
  const showToast = useCallback(
    (
      type: "success" | "error" | "info" | "warning",
      title: string,
      opts?: { description?: string },
    ) => {
      if (settings.enableToasts === false) return;
      toast[type](title, opts);
    },
    [settings.enableToasts],
  );

  const liveStatus = useLiveStatus({
    channelSlug: settings.kickChannelName,
    pollInterval: 120000,
    enabled: !!settings.kickChannelName,
    onStreamEnd: () => {
      queue.clearSession();
      showToast("info", "Yayın Sona Erdi", {
        description: "Sıra oturumu temizlendi.",
      });
    },
  });

  const queue = useQueue(liveStatus.isLive);

  const [singlePickOpen, setSinglePickOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState("queue");
  const [slideDirection, setSlideDirection] = useState<
    "left" | "right" | "none"
  >("none");

  const handleTabChange = useCallback(
    (value: string) => {
      const tabsOrder = ["queue", "teams", "moderation"];
      const prevIndex = tabsOrder.indexOf(activeTab);
      const newIndex = tabsOrder.indexOf(value);

      if (prevIndex !== -1 && newIndex !== -1 && prevIndex !== newIndex) {
        setSlideDirection(newIndex > prevIndex ? "right" : "left");
      }
      setActiveTab(value);
      localStorage.setItem("theatlas_active_tab", value);
    },
    [activeTab],
  );

  const [queueFilter, setQueueFilter] = useState<
    "all" | "queue" | "ingame" | "away"
  >("all");

  const handleQueueFilterChange = useCallback((value: string) => {
    setQueueFilter(value as any);
    localStorage.setItem("theatlas_queue_filter", value);
  }, []);

  useEffect(() => {
    const savedTab = localStorage.getItem("theatlas_active_tab");
    if (savedTab && ["queue", "teams", "moderation"].includes(savedTab)) {
      setActiveTab(savedTab);
    }

    const savedQueueFilter = localStorage.getItem("theatlas_queue_filter");
    if (
      savedQueueFilter &&
      ["all", "queue", "ingame", "away"].includes(savedQueueFilter)
    ) {
      setQueueFilter(savedQueueFilter as any);
    }
  }, []); // Runs once on mount — refs give us the latest values without a dep

  const isQueueIndicatorFirst = useRef(true);
  const [queueTabsList, setQueueTabsList] = useState<HTMLDivElement | null>(
    null,
  );
  const [queueIndicatorStyle, setQueueIndicatorStyle] =
    useState<React.CSSProperties>({
      position: "absolute",
      opacity: 0,
    });
  useEffect(() => {
    const tabsList = queueTabsList;
    if (!tabsList) return;

    const updateIndicator = () => {
      const activeTrigger = tabsList.querySelector(
        '[data-state="active"]',
      ) as HTMLElement;
      if (!activeTrigger) return;

      const parentRect = tabsList.getBoundingClientRect();
      const activeRect = activeTrigger.getBoundingClientRect();

      setQueueIndicatorStyle({
        position: "absolute",
        left: `${activeRect.left - parentRect.left}px`,
        top: `${activeRect.top - parentRect.top}px`,
        width: `${activeRect.width}px`,
        height: `${activeRect.height}px`,
        opacity: 1,
        transition: isQueueIndicatorFirst.current
          ? "none"
          : "all 300ms cubic-bezier(0.16, 1, 0.3, 1)",
      });
    };

    updateIndicator();
    const frameId = requestAnimationFrame(updateIndicator);
    const timeoutId = setTimeout(updateIndicator, 50);

    // Allow mount layout updates to settle before enabling smooth sliding transitions
    const skipTimer = setTimeout(() => {
      isQueueIndicatorFirst.current = false;
    }, 200);

    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(tabsList);

    // Observe all child triggers to catch dynamic flex layout stretching
    tabsList
      .querySelectorAll('[data-slot="tabs-trigger"]')
      .forEach((trigger) => {
        resizeObserver.observe(trigger);
      });

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(timeoutId);
      clearTimeout(skipTimer);
      resizeObserver.disconnect();
    };
  }, [queueTabsList, queueFilter, activeTab]);
  const [randomizeAlertOpen, setRandomizeAlertOpen] = useState(false);
  const [pickAlertOpen, setPickAlertOpen] = useState(false);
  const [pickOnlyInGame, setPickOnlyInGame] = useState(false);
  const [pendingTeamAddition, setPendingTeamAddition] = useState<{
    playerId: string;
    teamId: "A" | "B";
  } | null>(null);
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [targetTeamForManualAdd, setTargetTeamForManualAdd] = useState<
    "A" | "B" | null
  >(null);
  const [resolutionError, setResolutionError] = useState(false);
  const [kickConnectTimeout, setKickConnectTimeout] = useState(false);
  const [logosLoaded, setLogosLoaded] = useState(false);

  useEffect(() => {
    let loadedCount = 0;
    const urls = ["/TheAtlasB2048.png", "/TheAtlasW2048.png"];

    urls.forEach((url) => {
      const img = new Image();
      img.src = url;
      const handleLoad = () => {
        loadedCount++;
        if (loadedCount === urls.length) {
          setLogosLoaded(true);
        }
      };
      if (img.complete) {
        handleLoad();
      } else {
        img.onload = handleLoad;
        img.onerror = handleLoad;
      }
    });
  }, []);

  useEffect(() => {
    if (settings.kickChannelName) {
      setKickConnectTimeout(false);
      const timer = setTimeout(() => {
        setKickConnectTimeout(true);
        logger.warn(
          "[Dashboard] Kick connection wait timed out, showing dashboard",
        );
      }, 4000); // 4 seconds max safety timeout
      return () => clearTimeout(timer);
    } else {
      setKickConnectTimeout(true);
    }
  }, [settings.kickChannelName]);

  const [editingPlayer, setEditingPlayer] = useState<QueuePlayer | null>(null);
  const [moderationDialogOpen, setModerationDialogOpen] = useState(false);
  const [initialModeratePlayer, setInitialModeratePlayer] = useState<
    string | undefined
  >(undefined);
  const [initialModerateAction, setInitialModerateAction] = useState<
    "warning" | "punishment" | "ban" | undefined
  >(undefined);

  // Get player names for moderation autocomplete
  const playerNames = useMemo(
    () => queue.players.map((p) => p.kickUsername),
    [queue.players],
  );

  const pruneModeratedPlayer = useCallback(
    (username: string) => {
      // Find in players list
      const playerInQueue = queue.players.find(
        (p) => p.kickUsername.toLowerCase() === username.toLowerCase(),
      );
      if (playerInQueue) {
        queue.removePlayer(playerInQueue.id);
      }

      // Scan teamResult directly to prune them from teams if they are registered there
      if (queue.teamResult) {
        const playerInTeam =
          queue.teamResult.teamA.players.find(
            (p) => p.kickUsername.toLowerCase() === username.toLowerCase(),
          ) ||
          queue.teamResult.teamB.players.find(
            (p) => p.kickUsername.toLowerCase() === username.toLowerCase(),
          );
        if (
          playerInTeam &&
          (!playerInQueue || playerInTeam.id !== playerInQueue.id)
        ) {
          queue.removePlayer(playerInTeam.id);
        }
      }
    },
    [queue.players, queue.teamResult, queue.removePlayer],
  );

  const handleModerateRequest = useCallback(
    (kickUsername: string, actionType: "warning" | "punishment" | "ban") => {
      setInitialModeratePlayer(kickUsername);
      setInitialModerateAction(actionType);
      setModerationDialogOpen(true);
    },
    [],
  );

  const handleManualAddRequestForTeam = useCallback((teamId: "A" | "B") => {
    setTargetTeamForManualAdd(teamId);
    setManualAddOpen(true);
  }, []);

  const kickAccessToken = (session as unknown as Record<string, unknown>)
    ?.accessToken as string | undefined;

  const sendChatMessage = useCallback(async (message: string) => {
    // Chat feedback completely disabled by user request - only show toasts on the dashboard
  }, []);

  const fetchRiotData = useCallback(
    async (player: QueuePlayer) => {
      queue.updatePlayer(player.id, { isLoading: true });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      try {
        const res = await fetch("/api/riot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameName: player.riotGameName,
            tagLine: player.riotTagLine,
            region: settings.riotRegion,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          queue.updatePlayer(player.id, {
            ...data,
            isLoading: false,
            hasError: false,
          });
        } else {
          queue.updatePlayer(player.id, {
            isLoading: false,
            hasError: true,
            rankedTier: "UNRANKED",
          });
        }
      } catch {
        clearTimeout(timeoutId);
        queue.updatePlayer(player.id, {
          isLoading: false,
          hasError: true,
          rankedTier: "UNRANKED",
        });
      }
    },
    [settings.riotRegion, queue],
  );

  const handleDuplicateAttempt = useCallback(
    (kickUsername: string, riotId: string) => {
      const isRiotDisabled = settings.disableRiotApi || kickUsername === riotId;
      showToast("warning", "Tekrarlanan Kayıt", {
        description: isRiotDisabled
          ? `${kickUsername} kullanıcısı zaten sırada.`
          : `${kickUsername} kullanıcısı zaten ${riotId} olarak sırada.`,
      });
      sendChatMessage(
        `@${kickUsername}, zaten sıradadasın! Eğer bilgisayar başından ayrılacaksan veya sıradan çıkmak istiyorsan lütfen ${settings.afkCommand} yaz.`,
      );
    },
    [settings.disableRiotApi, settings.afkCommand, showToast, sendChatMessage],
  );

  const handleQueueCommand = useCallback(
    (kickUsername: string, gameName: string, tagLine: string) => {
      // Check if player is already in the queue (by kickUsername or by riotId)
      const existingPlayer = queue.players.find(
        (p) =>
          p.kickUsername.toLowerCase() === kickUsername.toLowerCase() ||
          (!settings.disableRiotApi &&
            p.riotGameName.toLowerCase() === gameName.toLowerCase() &&
            p.riotTagLine.toLowerCase() === tagLine.toLowerCase()),
      );

      if (existingPlayer) {
        // If the player is away, automatically bring them back and send to end of queue
        if (existingPlayer.isAway) {
          queue.setPlayers((prev) => {
            const without = prev.filter((p) => p.id !== existingPlayer.id);
            return [...without, { ...existingPlayer, isAway: false }];
          });
          showToast("info", "Geri Döndü", {
            description: `${existingPlayer.kickUsername} tekrar bilgisayar başında (sıranın sonuna eklendi).`,
          });
          return;
        }
        handleDuplicateAttempt(
          kickUsername,
          `${existingPlayer.riotGameName}#${existingPlayer.riotTagLine}`,
        );
        return;
      }

      const newPlayer: QueuePlayer = {
        id: `${gameName}#${tagLine}-${Date.now()}`,
        kickUsername,
        riotGameName: gameName,
        riotTagLine: tagLine,
        joinedAt: new Date(),
        isLoading: !settings.disableRiotApi,
      };

      // Check if player is banned
      if (moderation.isPlayerBanned(kickUsername)) {
        const record = moderation.getPlayerRecord(kickUsername);
        const activeBan = record.bans.find(
          (b) =>
            b.isActive &&
            (b.expiresAt === null || b.expiresAt > new Date().toISOString()),
        );
        let banReasonStr = "";
        if (activeBan && activeBan.reason) {
          banReasonStr = ` (Sebep: ${activeBan.reason})`;
        }
        showToast("error", "Yasaklı Oyuncu", {
          description: `${kickUsername} yasaklı olduğu için sıraya eklenemez.${banReasonStr}`,
        });
        sendChatMessage(
          `@${kickUsername}, şu anda yasaklı olduğun için sıraya eklenemezsin!${banReasonStr}`,
        );
        return;
      }

      // Check if player is punished
      if (moderation.isPlayerPunished(kickUsername)) {
        const record = moderation.getPlayerRecord(kickUsername);
        const activePunishment = record.punishments.find(
          (p) =>
            p.isActive &&
            (p.expiresAt === null || p.expiresAt > new Date().toISOString()),
        );
        let durationStr = "geçici bir süre";
        let reasonStr = "";
        if (activePunishment) {
          if (activePunishment.duration === "1_game") durationStr = "1 maçlık";
          else if (activePunishment.duration === "2_game")
            durationStr = "2 maçlık";
          else if (activePunishment.duration === "1_day")
            durationStr = "1 günlük";
          else if (activePunishment.duration === "1_week")
            durationStr = "1 haftalık";
          else if (
            activePunishment.duration === "custom" &&
            activePunishment.customDurationLabel
          )
            durationStr = activePunishment.customDurationLabel;

          if (activePunishment.reason) {
            reasonStr = ` (Sebep: ${activePunishment.reason})`;
          }
        }
        showToast("error", "Cezalı Oyuncu", {
          description: `${kickUsername} cezalı olduğu için sıraya eklenemez.${reasonStr}`,
        });
        sendChatMessage(
          `@${kickUsername}, şu anda ${durationStr} cezalı olduğun için sıraya eklenemezsin!${reasonStr}`,
        );
        return;
      }

      queue.addPlayer(newPlayer);

      if (settings.disableRiotApi) {
        showToast("success", "Sıraya Eklendi", {
          description: `${kickUsername}`,
        });
        return;
      }

      showToast("success", "Sıraya Eklendi", {
        description: `${kickUsername} → ${gameName}#${tagLine}`,
      });

      fetchRiotData(newPlayer);
    },
    [
      queue,
      fetchRiotData,
      settings.disableRiotApi,
      moderation,
      showToast,
      sendChatMessage,
      handleDuplicateAttempt,
    ],
  );

  const filteredPlayers = useMemo(() => {
    return queue.players.filter((p) => {
      if (queueFilter === "all") return true;
      if (queueFilter === "queue") return !p.isInGame && !p.isAway;
      if (queueFilter === "ingame") return p.isInGame;
      if (queueFilter === "away") return p.isAway;
      return true;
    });
  }, [queue.players, queueFilter]);

  const handleManualAdd = useCallback(
    (kickUsername: string, riotIdStr: string) => {
      let gameName = kickUsername;
      let tagLine = "";

      if (!settings.disableRiotApi) {
        const parts = riotIdStr.split("#");
        gameName = parts[0] || kickUsername;
        tagLine = parts[1] || "TR1";
      } else {
        tagLine = "MANUEL";
      }

      // Check if player is banned
      if (moderation.isPlayerBanned(kickUsername)) {
        const record = moderation.getPlayerRecord(kickUsername);
        const activeBan = record.bans.find(
          (b) =>
            b.isActive &&
            (b.expiresAt === null || b.expiresAt > new Date().toISOString()),
        );
        let banReasonStr = "";
        if (activeBan && activeBan.reason) {
          banReasonStr = ` (Sebep: ${activeBan.reason})`;
        }
        showToast("error", "Yasaklı Oyuncu", {
          description: `${kickUsername} yasaklı olduğu için sıraya eklenemez.${banReasonStr}`,
        });
        sendChatMessage(
          `@${kickUsername}, şu anda yasaklı olduğun için sıraya eklenemezsin!${banReasonStr}`,
        );
        return;
      }

      // Check if player is punished
      if (moderation.isPlayerPunished(kickUsername)) {
        const record = moderation.getPlayerRecord(kickUsername);
        const activePunishment = record.punishments.find(
          (p) =>
            p.isActive &&
            (p.expiresAt === null || p.expiresAt > new Date().toISOString()),
        );
        let durationStr = "geçici bir süre";
        let reasonStr = "";
        if (activePunishment) {
          if (activePunishment.duration === "1_game") durationStr = "1 maçlık";
          else if (activePunishment.duration === "2_game")
            durationStr = "2 maçlık";
          else if (activePunishment.duration === "1_day")
            durationStr = "1 günlük";
          else if (activePunishment.duration === "1_week")
            durationStr = "1 haftalık";
          else if (
            activePunishment.duration === "custom" &&
            activePunishment.customDurationLabel
          )
            durationStr = activePunishment.customDurationLabel;

          if (activePunishment.reason) {
            reasonStr = ` (Sebep: ${activePunishment.reason})`;
          }
        }
        showToast("error", "Cezalı Oyuncu", {
          description: `${kickUsername} cezalı olduğu için sıraya eklenemez.${reasonStr}`,
        });
        sendChatMessage(
          `@${kickUsername}, şu anda ${durationStr} cezalı olduğun için sıraya eklenemezsin!${reasonStr}`,
        );
        return;
      }

      const existingPlayer = queue.players.find(
        (p) =>
          p.kickUsername.toLowerCase() === kickUsername.toLowerCase() ||
          (!settings.disableRiotApi &&
            p.riotGameName.toLowerCase() === gameName.toLowerCase() &&
            p.riotTagLine.toLowerCase() === tagLine.toLowerCase()),
      );

      if (existingPlayer) {
        handleDuplicateAttempt(
          kickUsername,
          `${existingPlayer.riotGameName}#${existingPlayer.riotTagLine}`,
        );
        return;
      }

      if (targetTeamForManualAdd && queue.teamResult) {
        const targetTeam =
          targetTeamForManualAdd === "A"
            ? queue.teamResult.teamA
            : queue.teamResult.teamB;
        if (targetTeam.players.length >= settings.teamSize) {
          showToast("error", "Takım Dolu", {
            description: `${targetTeam.name} zaten ${settings.teamSize} kişi limitine ulaştı.`,
          });
          return;
        }
      }

      const newPlayer: QueuePlayer = {
        id: crypto.randomUUID(),
        kickUsername,
        riotGameName: gameName,
        riotTagLine: tagLine,
        joinedAt: new Date(),
        isInGame: !!targetTeamForManualAdd,
        isAway: false,
        isLoading: !settings.disableRiotApi,
      };

      queue.addPlayer(newPlayer);

      if (targetTeamForManualAdd) {
        queue.setTeamResult((prev) => {
          if (!prev) {
            return {
              teamA: {
                name: "Mavi Takım",
                players: targetTeamForManualAdd === "A" ? [newPlayer] : [],
              },
              teamB: {
                name: "Kırmızı Takım",
                players: targetTeamForManualAdd === "B" ? [newPlayer] : [],
              },
              createdAt: new Date(),
            };
          }
          const filteredA = prev.teamA.players.filter(
            (p) => p.id !== newPlayer.id,
          );
          const filteredB = prev.teamB.players.filter(
            (p) => p.id !== newPlayer.id,
          );
          return {
            ...prev,
            teamA: {
              ...prev.teamA,
              players:
                targetTeamForManualAdd === "A"
                  ? [...filteredA, newPlayer]
                  : filteredA,
            },
            teamB: {
              ...prev.teamB,
              players:
                targetTeamForManualAdd === "B"
                  ? [...filteredB, newPlayer]
                  : filteredB,
            },
          };
        });
        showToast("success", "Takıma Eklendi", {
          description: `${kickUsername}, ${targetTeamForManualAdd === "A" ? "Mavi Takım" : "Kırmızı Takım"}'a katıldı.`,
        });
        setTargetTeamForManualAdd(null);
      } else {
        showToast("success", "Oyuncu Eklendi", {
          description: `${kickUsername} sıraya eklendi.`,
        });
      }

      if (!settings.disableRiotApi) {
        fetchRiotData(newPlayer);
      }
    },
    [
      queue,
      settings.disableRiotApi,
      settings.teamSize,
      moderation,
      showToast,
      handleDuplicateAttempt,
      fetchRiotData,
      targetTeamForManualAdd,
      sendChatMessage,
    ],
  );

  // Auto-fill chatroomId from session if settings are empty
  useEffect(() => {
    const sessionChatroomId = (session?.user as any)?.chatroomId;
    if (
      status === "authenticated" &&
      sessionChatroomId &&
      !settings.manualChatroomId
    ) {
      updateSettings({ manualChatroomId: String(sessionChatroomId) });
      console.log(
        "[Dashboard] Auto-populated chatroom ID from session:",
        sessionChatroomId,
      );
    }
  }, [status, session, settings.manualChatroomId, updateSettings]);

  // Auto-fill kickChannelName from session (Kick sign-in username = channel slug)
  useEffect(() => {
    if (status === "authenticated" && session?.user?.name) {
      const channelSlug = session.user.name.toLowerCase();
      if (settings.kickChannelName !== channelSlug) {
        updateSettings({ kickChannelName: channelSlug });
        logger.log(
          "[Dashboard] Auto-populated kick channel from session:",
          channelSlug,
        );
      }
    }
  }, [status, session, settings.kickChannelName, updateSettings]);

  // Migrate queue/team data when the Riot ID requirement setting changes
  const prevDisableRiotApiRef = useRef(settings.disableRiotApi);
  useEffect(() => {
    const prev = prevDisableRiotApiRef.current;
    const curr = settings.disableRiotApi;
    prevDisableRiotApiRef.current = curr;

    // Skip initial mount or no change
    if (prev === curr) return;

    if (curr) {
      // Riot API just got DISABLED → convert existing players to kick-only format
      const convertPlayer = (p: QueuePlayer): QueuePlayer => ({
        ...p,
        riotGameName: p.kickUsername,
        riotTagLine: "KICK",
        isLoading: false,
        hasError: false,
        // Clear Riot-specific fields
        rankedTier: undefined,
        rankedDivision: undefined,
        leaguePoints: undefined,
        wins: undefined,
        losses: undefined,
        winRate: undefined,
        profileIconId: undefined,
        summonerLevel: undefined,
      });

      queue.setPlayers((prev) => prev.map(convertPlayer));
      queue.setTeamResult((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          teamA: { ...prev.teamA, players: prev.teamA.players.map(convertPlayer) },
          teamB: { ...prev.teamB, players: prev.teamB.players.map(convertPlayer) },
        };
      });

      if (queue.players.length > 0) {
        showToast("info", "Sıra Güncellendi", {
          description: "Riot ID zorunluluğu kaldırıldı. Mevcut oyuncular güncellendi.",
        });
      }
    } else {
      // Riot API just got ENABLED → clear players that don't have real Riot IDs
      const hasRealRiotId = (p: QueuePlayer) =>
        p.riotTagLine !== "KICK" && p.riotTagLine !== "MANUEL" && p.riotGameName !== p.kickUsername;

      const playersToKeep = queue.players.filter(hasRealRiotId);
      const removedCount = queue.players.length - playersToKeep.length;

      if (removedCount > 0) {
        queue.setPlayers(playersToKeep);
        queue.setTeamResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            teamA: { ...prev.teamA, players: prev.teamA.players.filter(hasRealRiotId) },
            teamB: { ...prev.teamB, players: prev.teamB.players.filter(hasRealRiotId) },
          };
        });
        showToast("warning", "Sıra Temizlendi", {
          description: `Riot ID zorunluluğu açıldı. Riot ID'si olmayan ${removedCount} oyuncu sıradan çıkarıldı.`,
        });
      }
    }
  }, [settings.disableRiotApi]);

  const handleAfkCommand = useCallback(
    (kickUsername: string) => {
      const existingPlayer = queue.players.find(
        (p) => p.kickUsername.toLowerCase() === kickUsername.toLowerCase(),
      );
      if (existingPlayer) {
        const isCurrentlyAway = existingPlayer.isAway;
        queue.updatePlayer(existingPlayer.id, { isAway: !isCurrentlyAway });

        if (isCurrentlyAway) {
          showToast("info", "Geri Döndü", {
            description: `${existingPlayer.kickUsername} tekrar bilgisayar başında.`,
          });
        } else {
          showToast("info", "AFK Bildirimi", {
            description: `${existingPlayer.kickUsername} şu an bilgisayar başında değil (Uzakta).`,
          });
        }
      }
    },
    [queue],
  );

  const kickChat = useKickChat({
    channelSlug: settings.kickChannelName,
    accessToken: kickAccessToken,
    onQueueCommand: handleQueueCommand,
    onDuplicateAttempt: handleDuplicateAttempt,
    isDuplicate: queue.isDuplicate,
    enabled: !!settings.kickChannelName,
    queueCommand: settings.queueCommand,
    afkCommand: settings.afkCommand,
    onAfkCommand: handleAfkCommand,
    disableRiotApi: settings.disableRiotApi,
    initialChatroomId: settings.manualChatroomId
      ? parseInt(settings.manualChatroomId)
      : status === "authenticated"
        ? (session?.user as any)?.chatroomId
        : null,
    onChatroomResolved: (id) => {
      if (!settings.manualChatroomId) {
        updateSettings({ manualChatroomId: String(id) });
        logger.log("[Dashboard] Auto-saved discovered chatroom ID:", id);
      }
    },
    onResolutionFail: () => {
      setResolutionError(true);
      router.push("/settings");
      showToast("error", "Kick ID Bulunamadı", {
        description:
          "Kanal ID otomatik çözümlenemedi. Lütfen Manuel ID kısmını doldurun.",
      });
    },
  });

  const executeRandomize = useCallback(
    (onlyInGame: boolean) => {
      const minPlayers = onlyInGame ? 3 : settings.teamSize * 2;
      const inGameCount = queue.players.filter(
        (p) => !p.isAway && p.isInGame,
      ).length;

      if (onlyInGame && inGameCount < minPlayers) {
        showToast("error", "Yetersiz Oyuncu", {
          description: `Takımları karıştırmak için en az 3 "Oyunda" işaretli oyuncu gerekli. ${inGameCount} oyuncu bulundu.`,
        });
        return;
      }

      const result = queue.randomizeTeams(settings.teamSize, onlyInGame);
      if (result) {
        setActiveTab("teams");
        showToast("success", "Takımlar Oluşturuldu", {
          description: `${result.teamA.name} vs ${result.teamB.name}`,
        });
      }
    },
    [queue, settings.teamSize],
  );

  const handleRandomize = useCallback(() => {
    const minPlayersFull = settings.teamSize * 2;
    const minPlayersInGame = 3;

    const activeLength = queue.players.filter((p) => !p.isAway).length;
    const inGameCount = queue.players.filter(
      (p) => !p.isAway && p.isInGame,
    ).length;

    const canDoFull = activeLength >= minPlayersFull;
    const canDoInGameOnly = inGameCount >= minPlayersInGame;

    if (!canDoFull && !canDoInGameOnly) {
      showToast("error", "Yetersiz Oyuncu", {
        description: `Takım oluşturmak için sıradan en az ${minPlayersFull} veya takımları karıştırmak için takımdan en az ${minPlayersInGame} oyuncu gerekli.`,
      });
      return;
    }

    if (canDoFull && canDoInGameOnly) {
      setRandomizeAlertOpen(true);
      return;
    }

    if (canDoFull && !canDoInGameOnly) {
      executeRandomize(false);
      return;
    }

    if (!canDoFull && canDoInGameOnly) {
      executeRandomize(true);
      return;
    }
  }, [queue.players, settings.teamSize, executeRandomize]);

  const handleClearQueue = useCallback(() => {
    if (queue.players.length === 0) return;
    setClearConfirm(true);
  }, [queue.players.length]);

  const confirmClear = useCallback(() => {
    queue.clearQueue();
    setClearConfirm(false);
    setActiveTab("queue");
    showToast("info", "Sıra Temizlendi", {
      description: "Tüm oyuncular sıradan kaldırıldı.",
    });
  }, [queue]);

  const handleSinglePick = useCallback(() => {
    const activeLength = queue.players.filter((p) => !p.isAway).length;
    const inGameCount = queue.players.filter(
      (p) => !p.isAway && p.isInGame,
    ).length;

    if (activeLength < 2) {
      showToast("error", "Tek Çekim için en az 2 aktif oyuncu gerekli", {});
      return;
    }

    if (inGameCount > 0) {
      setPickAlertOpen(true);
      return;
    }

    setPickOnlyInGame(false);
    setSinglePickOpen(true);
  }, [queue.players]);

  const shouldWaitKick =
    !!settings.kickChannelName &&
    !kickChat.isConnected &&
    !kickConnectTimeout &&
    !resolutionError;

  if (
    settingsLoading ||
    status === "loading" ||
    shouldWaitKick ||
    !logosLoaded
  ) {
    return <Loading />;
  }

  return (
    <>
      <GlobalContextMenu
        playerCount={queue.players.length}
        isTeamsCreated={!!queue.teamResult}
        onClearQueue={handleClearQueue}
        onRandomize={handleRandomize}
        onSinglePick={handleSinglePick}
        onOpenSettings={() => router.push("/settings")}
        onReconnect={kickChat.reconnect}
      >
        <div className="flex min-h-screen flex-col">
          <Header
            isConnected={kickChat.isConnected}
            isLive={liveStatus.isLive}
            streamTitle={liveStatus.streamTitle}
            playerCount={queue.players.length}
            onOpenSettings={() => router.push("/settings")}
          />

          <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between animate-slide-right-fade">
              <div>
                <h2
                  className="text-lg font-heading font-normal tracking-tight"
                  style={{ letterSpacing: "-0.02em" }}
                >
                  {settings.pageTitle || "Şamata Sırası"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {settings.pageSubtitle || "ARAM Mayhem 5v5 özel lobi yönetimi"}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                {/* Add Player */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 h-9"
                      onClick={() => setManualAddOpen(true)}
                      id="add-player-button"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Ekle</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Sıraya manuel oyuncu ekle</p>
                  </TooltipContent>
                </Tooltip>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Pick / Shuffle group */}
                <div className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={
                          queue.players.filter((p) => !p.isAway).length < 2
                            ? 0
                            : undefined
                        }
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 h-9"
                          onClick={handleSinglePick}
                          disabled={
                            queue.players.filter((p) => !p.isAway).length < 2
                          }
                          id="single-pick-button"
                        >
                          <Dices className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Tek Çekim</span>
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Sıradan rastgele bir oyuncu seç</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={
                          !(
                            queue.players.filter((p) => !p.isAway).length >=
                            settings.teamSize * 2 ||
                            (!!queue.teamResult &&
                              queue.players.filter(
                                (p) => !p.isAway && p.isInGame,
                              ).length >= 3)
                          )
                            ? 0
                            : undefined
                        }
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 h-9"
                          onClick={handleRandomize}
                          disabled={
                            !(
                              queue.players.filter((p) => !p.isAway).length >=
                              settings.teamSize * 2 ||
                              (queue.teamResult &&
                                queue.players.filter(
                                  (p) => !p.isAway && p.isInGame,
                                ).length >= 3)
                            )
                          }
                          id="randomize-button"
                        >
                          <Shuffle className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Karıştır</span>
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {!(
                        queue.players.filter((p) => !p.isAway).length >=
                        settings.teamSize * 2 ||
                        (queue.teamResult &&
                          queue.players.filter((p) => !p.isAway && p.isInGame)
                            .length >= 3)
                      ) ? (
                        <p>
                          Karıştırmak için sırada en az {settings.teamSize * 2}{" "}
                          aktif oyuncu veya takımlarda en az 3 kişi olmalı.
                        </p>
                      ) : (
                        <p>Takımları rastgele oluştur veya karıştır</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className="w-px h-5 bg-border mx-1" />

                {/* Destructive — Clear */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={queue.players.length === 0 ? 0 : undefined}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 h-9 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={handleClearQueue}
                        disabled={queue.players.length === 0}
                        id="clear-queue-button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Temizle</span>
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Sırayı tamamen temizle</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            <div
              className="animate-slide-up-fade"
              style={{ animationDelay: "100ms" }}
            >
              <Tabs
                value={activeTab}
                onValueChange={handleTabChange}
                className={
                  slideDirection === "right"
                    ? "slide-from-right"
                    : slideDirection === "left"
                      ? "slide-from-left"
                      : ""
                }
              >
                <TabsList variant="underline" className="mb-4 w-full sm:w-auto">
                  <TabsTrigger value="queue" className="gap-2" id="tab-queue">
                    <ListOrdered className="h-3.5 w-3.5" />
                    Sıra
                    {queue.players.length > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-1 h-5 min-w-5 rounded-full p-0 flex items-center justify-center text-[10px] leading-none font-semibold"
                      >
                        {queue.players.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="teams" className="gap-2" id="tab-teams">
                    <Swords className="h-3.5 w-3.5" />
                    Takımlar
                    {queue.teamResult && (
                      <Sparkles className="h-3 w-3 text-warning" />
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="moderation"
                    className="gap-2"
                    id="tab-moderation"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    Moderasyon
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="queue" className="mt-0">
                  <Card className="border-border/50">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-sm">
                            {settings.queueCardTitle || "Oyuncu Sırası"}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {queue.players.length === 0
                              ? (settings.queueCardDescription
                                ? settings.queueCardDescription.replace("{command}", `${settings.queueCommand}${settings.disableRiotApi ? "" : " İsim#TAG"}`)
                                : `Kick sohbetinde "${settings.queueCommand}${settings.disableRiotApi ? "" : " İsim#TAG"}" yazarak katılın`)
                              : `${queue.players.length} oyuncu sırada bekliyor`}
                          </CardDescription>
                        </div>
                        {queue.stats.loading > 0 && (
                          <Badge
                            variant="outline"
                            className="text-[10px] gap-1"
                          >
                            <div className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
                            {queue.stats.loading} yükleniyor
                          </Badge>
                        )}
                      </div>
                      <Tabs
                        value={queueFilter}
                        onValueChange={handleQueueFilterChange}
                        className="mt-3 w-full"
                      >
                        <TabsList
                          ref={setQueueTabsList}
                          className="relative flex w-full bg-muted/50 p-1 sliding-tabs"
                        >
                          <div
                            className="absolute rounded-md bg-background shadow-sm dark:bg-input/40 pointer-events-none"
                            style={queueIndicatorStyle}
                          />
                          <TabsTrigger
                            value="all"
                            className="relative z-10 text-xs"
                          >
                            Tümü
                          </TabsTrigger>
                          <TabsTrigger
                            value="queue"
                            className="relative z-10 text-xs"
                          >
                            Sıradakiler
                          </TabsTrigger>
                          <TabsTrigger
                            value="ingame"
                            className="relative z-10 text-xs"
                          >
                            Oyundakiler
                          </TabsTrigger>
                          <TabsTrigger
                            value="away"
                            className="relative z-10 text-xs"
                          >
                            Uzaktalar
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <GlobalContextMenu
                        playerCount={queue.players.length}
                        isTeamsCreated={!!queue.teamResult}
                        onClearQueue={handleClearQueue}
                        onRandomize={handleRandomize}
                        onSinglePick={handleSinglePick}
                        onOpenSettings={() => router.push("/settings")}
                        onReconnect={kickChat.reconnect}
                        onManualAddRequest={() => setManualAddOpen(true)}
                      >
                        <div className="min-h-49 w-full overflow-y-auto">
                          <QueueTable
                            players={filteredPlayers}
                            onRemovePlayer={queue.removePlayer}
                            onUpdatePlayer={queue.updatePlayer}
                            onReorder={queue.reorderPlayers}
                            queueCommand={settings.queueCommand}
                            disableRiotApi={settings.disableRiotApi}
                            onAddToTeam={(id, tid) =>
                              queue.addPlayerToTeam(id, tid, settings.teamSize)
                            }
                            onRemoveFromTeam={queue.removePlayerFromTeam}
                            isTeamsCreated={!!queue.teamResult}
                            onCreateTeamsRequest={(playerId, teamId) =>
                              setPendingTeamAddition({ playerId, teamId })
                            }
                            onEditPlayer={setEditingPlayer}
                            onModerate={handleModerateRequest}
                            moderation={moderation}
                            emptyQueueTitle={settings.emptyQueueTitle}
                            emptyQueueDescription={settings.emptyQueueDescription}
                          />
                        </div>
                      </GlobalContextMenu>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="teams" className="mt-0">
                  {queue.teamResult ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-medium">
                            Takım Sonuçları
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {new Date(
                              queue.teamResult.createdAt,
                            ).toLocaleString("tr-TR")}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRandomize}
                            className="gap-2"
                            id="re-randomize-button"
                          >
                            <Shuffle className="h-3.5 w-3.5" />
                            Yeniden Karıştır
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => queue.clearTeams()}
                            className="gap-2 text-destructive hover:text-destructive focus:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Sil
                          </Button>
                        </div>
                      </div>
                      <TeamDisplay
                        result={queue.teamResult}
                        movePlayerBetweenTeams={(id, tid) =>
                          queue.movePlayerBetweenTeams(
                            id,
                            tid,
                            settings.teamSize,
                          )
                        }
                        removePlayerFromTeam={queue.removePlayerFromTeam}
                        onUpdatePlayer={queue.updatePlayer}
                        onRemovePlayer={queue.removePlayer}
                        disableRiotApi={settings.disableRiotApi}
                        onReorderTeam={queue.reorderTeam}
                        onEditPlayer={setEditingPlayer}
                        queuePlayers={queue.players}
                        onModerate={handleModerateRequest}
                        onManualAddRequest={handleManualAddRequestForTeam}
                        onClearQueue={handleClearQueue}
                        onRandomize={handleRandomize}
                        onSinglePick={handleSinglePick}
                        onOpenSettings={() => router.push("/settings")}
                        onReconnect={kickChat.reconnect}
                      />
                    </div>
                  ) : (
                    <Card className="border-dashed">
                      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                        <Swords className="h-10 w-10 text-muted-foreground/30 mb-4" />
                        <p className="text-sm text-muted-foreground">
                          Henüz takım oluşturulmadı
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1 mb-6">
                          Aşağıdaki butona tıklayarak takımları oluşturabilir ve
                          kurrayı başlatabilirsiniz.
                        </p>
                        <Button onClick={() => queue.createEmptyTeams()}>
                          Takımları Oluştur
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="moderation" className="mt-0">
                  <ModerationPanel
                    warnings={moderation.warnings}
                    punishments={moderation.punishments}
                    bans={moderation.bans}
                    respectScores={moderation.respectScores}
                    history={moderation.history}
                    onRevokeWarning={moderation.revokeWarning}
                    onRevokePunishment={moderation.revokePunishment}
                    onRevokeBan={moderation.revokeBan}
                    onDeleteHistoryItem={moderation.deleteHistoryItem}
                    onClearAllHistory={moderation.clearAllHistory}
                    onNewAction={(kickUsername, actionType) => {
                      setInitialModeratePlayer(kickUsername);
                      setInitialModerateAction(actionType);
                      setModerationDialogOpen(true);
                    }}
                    onIssueWarningDirectly={(kickUsername) => {
                      const result = moderation.issueWarning(
                        kickUsername,
                        "Yönetici Tarafından Doğrudan Uyarı",
                      );
                      if (result.automaticallyPunished) {
                        pruneModeratedPlayer(kickUsername);
                        showToast(
                          "error",
                          "Uyarı Sınırı Aşıldı - Ceza Verildi",
                          {
                            description: `${kickUsername} uyarı limiti aşıldığı için tüm uyarıları silindi ve 1 maçlık ceza uygulandı.`,
                          },
                        );
                        return;
                      }
                      if (result.warning) {
                        showToast(
                          "warning",
                          `${result.warning.level}. Uyarı Verildi`,
                          {
                            description: `${kickUsername}: Yönetici Tarafından Doğrudan Uyarı`,
                          },
                        );

                        if (result.shouldEscalate) {
                          moderation.issuePunishment(
                            kickUsername,
                            "1_game",
                            "2. Uyarı Sınırı Aşıldı (Sistem Tarafından Uygulandı)",
                            "Sistem",
                          );
                          pruneModeratedPlayer(kickUsername);
                          showToast("warning", "Otomatik Ceza Verildi", {
                            description: `${kickUsername} 2. uyarıya ulaştığı için 1 maçlık ceza uygulandı ve sıradan çıkarıldı.`,
                          });
                        }
                      }
                    }}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </main>

          <Watermark />



          <SinglePickDialog
            open={singlePickOpen}
            onOpenChange={setSinglePickOpen}
            players={queue.players}
            pickRandomPlayer={queue.pickRandomPlayer}
            onlyInGame={pickOnlyInGame}
            onRemoveFromTeam={queue.removePlayerFromTeam}
            animationStyle={settings.pickAnimationStyle ?? "classic"}
          />

          <ManualAddDialog
            open={manualAddOpen}
            onOpenChange={setManualAddOpen}
            onAdd={handleManualAdd}
            disableRiotApi={!!settings.disableRiotApi}
          />

          <EditPlayerDialog
            open={!!editingPlayer}
            onOpenChange={(open) => {
              if (!open) setEditingPlayer(null);
            }}
            player={editingPlayer}
            onSave={queue.updatePlayer}
            disableRiotApi={!!settings.disableRiotApi}
          />

          <ModerationActionDialog
            open={moderationDialogOpen}
            onOpenChange={(open) => {
              setModerationDialogOpen(open);
              if (!open) {
                setInitialModeratePlayer(undefined);
                setInitialModerateAction(undefined);
              }
            }}
            playerNames={playerNames}
            currentWarningLevel={(username: string) =>
              moderation.getPlayerRecord(username).currentWarningLevel
            }
            onIssueWarning={(username, reason) => {
              const result = moderation.issueWarning(username, reason);

              if (result.automaticallyPunished) {
                pruneModeratedPlayer(username);
                showToast("error", "Uyarı Sınırı Aşıldı - Ceza Verildi", {
                  description: `${username} uyarı limiti aşıldığı için tüm uyarıları silindi ve 1 maçlık ceza uygulandı.`,
                });
                return;
              }

              if (result.warning) {
                showToast("warning", `${result.warning.level}. Uyarı Verildi`, {
                  description: `${username}: ${reason}`,
                });

                // Check if warning escalated to level 2, which triggers a 1 game punishment automatically
                if (result.shouldEscalate) {
                  moderation.issuePunishment(
                    username,
                    "1_game",
                    "2. Uyarı Sınırı Aşıldı (Sistem Tarafından Uygulandı)",
                    "Sistem",
                  );
                  pruneModeratedPlayer(username);
                  showToast("warning", "Otomatik Ceza Verildi", {
                    description: `${username} 2. uyarıya ulaştığı için 1 maçlık ceza uygulandı ve sıradan çıkarıldı.`,
                  });
                }
              }
            }}
            onIssuePunishment={(
              username,
              duration,
              reason,
              customMs,
              customLabel,
            ) => {
              moderation.issuePunishment(
                username,
                duration,
                reason,
                "Admin",
                customMs,
                customLabel,
              );
              pruneModeratedPlayer(username);
              showToast("warning", "Ceza Verildi", {
                description: `${username}: ${reason}`,
              });
            }}
            onIssueBan={(username, duration, reason) => {
              moderation.issueBan(username, duration, reason);
              pruneModeratedPlayer(username);
              showToast("error", "Yasaklandı", {
                description: `${username}: ${reason}`,
              });
            }}
            initialKickUsername={initialModeratePlayer}
            initialActionType={initialModerateAction}
          />

          <AlertDialog open={clearConfirm} onOpenChange={setClearConfirm}>
            <AlertDialogContent id="clear-confirm">
              <AlertDialogHeader>
                <AlertDialogTitle>Sırayı Temizle</AlertDialogTitle>
                <AlertDialogDescription>
                  Sıradaki tüm oyuncular kaldırılacak. Bu işlem geri alınamaz.
                  Devam etmek istiyor musunuz?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>İptal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmClear}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Temizle
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={randomizeAlertOpen}
            onOpenChange={setRandomizeAlertOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Kimi Karıştıralım?</AlertDialogTitle>
                <AlertDialogDescription>
                  Şu anda "Oyunda" olarak işaretli hazır bir grubunuz var.
                  Yeniden takımları oluştururken mevcut takımdakiler kendi
                  aralarında mı karıştırılsın, yoksa tüm sıra listesi mi dahil
                  edilsin?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:space-x-0">
                <AlertDialogCancel className="mt-0 sm:mr-auto">
                  İptal
                </AlertDialogCancel>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRandomizeAlertOpen(false);
                    executeRandomize(false);
                  }}
                >
                  Tüm Sıra
                </Button>
                <Button
                  onClick={() => {
                    setRandomizeAlertOpen(false);
                    executeRandomize(true);
                  }}
                >
                  Sadece Takımlar
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog open={pickAlertOpen} onOpenChange={setPickAlertOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Nereden Çekelim?</AlertDialogTitle>
                <AlertDialogDescription>
                  Mevcut sırada "Oyunda" olarak atanmış oyuncular bulunuyor.
                  Çekilişi tüm sıradaki oyuncular arasından mı, yoksa sadece
                  "Oyunda" olan takımlar arasından mı yapmak istersiniz?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:space-x-0">
                <AlertDialogCancel className="mt-0 sm:mr-auto">
                  İptal
                </AlertDialogCancel>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPickAlertOpen(false);
                    setPickOnlyInGame(false);
                    setSinglePickOpen(true);
                  }}
                >
                  Tüm Sıra
                </Button>
                <Button
                  onClick={() => {
                    setPickAlertOpen(false);
                    setPickOnlyInGame(true);
                    setSinglePickOpen(true);
                  }}
                >
                  Sadece Takımlar
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={!!pendingTeamAddition}
            onOpenChange={(open) => {
              if (!open) setPendingTeamAddition(null);
            }}
          >
            <AlertDialogContent id="create-teams-alert">
              <AlertDialogHeader>
                <AlertDialogTitle>Takımlar Oluşturulmadı</AlertDialogTitle>
                <AlertDialogDescription>
                  Henüz takımlar oluşturulmadı. Mavi ve Kırmızı takımları manuel
                  olarak doldurmaya hazır hale getirip, seçili oyuncuyu eklemek
                  ister misiniz?
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>İptal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (!queue.teamResult) {
                      queue.createEmptyTeams();
                    }

                    if (pendingTeamAddition) {
                      queue.addPlayerToTeam(
                        pendingTeamAddition.playerId,
                        pendingTeamAddition.teamId,
                        settings.teamSize,
                      );
                    }
                    setPendingTeamAddition(null);
                  }}
                >
                  Oluştur ve Ekle
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </GlobalContextMenu>
    </>
  );
}
