const translations = {
  en: {
    "meta.title": "Dachuan Song | AI Research & Engineering",
    "meta.description":
      "Dachuan Song is a Ph.D. student at George Mason University researching efficient sequence architectures, long-context memory, and budget-aware inference.",
    "language.button": "中文",
    "language.aria": "Switch to Chinese",
    "easterEgg.coinLabel": "Hidden contact easter egg",
    "easterEgg.dialogLabel": "WeChat QR code",
    "easterEgg.closeLabel": "Close WeChat QR code",
    "easterEgg.qrAlt": "WeChat QR code for Dachuan Song",
    "nav.about": "About",
    "nav.skills": "Skills",
    "nav.papers": "Papers",
    "nav.cv": "CV",
    "nav.contact": "Contact",
    "hero.eyebrow": "State Space Models · Long Contexts · LLM Agents · Efficient Inference",
    "hero.lead":
      "I build sequence models and compact memory for long contexts, so useful information remains accessible without making inference prohibitively expensive.",
    "hero.availability": "Seeking Summer 2027 research internships.",
    "hero.linksLabel": "Profile links",
    "links.email": "Email",
    "links.emailCopyAria": "Copy email address",
    "links.emailCopied": "Copied",
    "links.emailCopyFailed": "Copy failed",
    "links.scholar": "Scholar",
    "profile.summaryLabel": "Profile summary",
    "profile.role": "Ph.D. Student",
    "profile.program": "Electrical & Computer Engineering",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia, USA",
    "about.kicker": "Direction",
    "about.title": "State Space Models,<br>Long Contexts,<br>Efficient Inference.",
    "about.p1":
      "I am a Ph.D. student at <a class=\"direction-link\" href=\"https://www.gmu.edu/\" target=\"_blank\" rel=\"noreferrer\">George Mason University</a>, advised by <a class=\"direction-link\" href=\"https://mason.gmu.edu/~xwang64/index.html\" target=\"_blank\" rel=\"noreferrer\">Prof. Xuan Wang</a>.<br>I work on how models retain and use information over long sequences, and on the cost of doing so at inference time.",
    "about.p2":
      "Recent work uses ordered spectral channels to export different model sizes from one checkpoint. I also study input-dependent recurrent memory and mergeable states that let language models carry evidence across context segments.",
    "areas.kicker": "Research Areas",
    "areas.agent.title": "Reliable LLM Agents",
    "areas.agent.body":
      "Study how agent memory and provenance can keep tool-using systems grounded in current evidence instead of stale context.",
    "areas.sequence.title": "Efficient Long-Sequence Modeling",
    "areas.sequence.body":
      "Combine input-dependent recurrent memory with local attention to process long sequences at manageable inference cost.",
    "areas.ssm.title": "Spectral State Space Models",
    "areas.ssm.body":
      "Use ordered spectral channels as a capacity axis: truncate a trained model's channel prefix to export smaller, standalone versions.",
    "skills.kicker": "Skills",
    "skills.title": "Core technical areas.",
    "skills.dl.title": "Deep Learning",
    "skills.dl.1": "Transformers and attention",
    "skills.dl.2": "Foundation model adaptation",
    "skills.dl.3": "Optimization and representation learning",
    "skills.sequence.title": "Long-Sequence Modeling",
    "skills.sequence.1": "Hybrid sequence architectures",
    "skills.sequence.2": "Length generalization",
    "skills.sequence.3": "Budget-aware inference",
    "skills.ssm.title": "State Space Models",
    "skills.ssm.1": "Spectral state-space models",
    "skills.ssm.2": "Linear dynamical systems",
    "skills.ssm.3": "Efficient sequence operators",
    "skills.agent.title": "LLM Agents",
    "skills.agent.1": "Tool-using agents",
    "skills.agent.2": "Agent memory",
    "skills.agent.3": "Workflow reliability",
    "publications.kicker": "Publications",
    "publications.title": "Published papers",
    "publications.link.code": "Code",
    "publications.links.sketchops": "SketchOps paper links",
    "publications.links.es": "Elastic Spectral State Space Models links",
    "publications.links.essh": "Elastic Selective Spectral Hybrids paper links",
    "publications.links.fmri": "fMRI journal article links",
    "publications.links.bcb": "ACM BCB conference paper links",
    "publications.sketchops.type": "Preprint",
    "publications.sketchops.venue": "arXiv · 2026",
    "publications.sketchops.title": "Mergeable Model-Side Aggregation States for Long-Context Language Models",
    "publications.sketchops.summary":
      "Language models struggle to aggregate counts and set relations over long histories. SketchOps adds a fixed 2 KiB state that merges across chunks; on 3,969 aggregate-then-reason tasks it reached 99.2% accuracy without rereading the full context.",
    "publications.sketchops.keywords":
      "SketchOps · HyperLogLog · Long-context reasoning · Fixed-budget aggregation",
    "publications.es.type": "Conference Paper",
    "publications.es.venue": "Accepted · Poster",
    "publications.es.badge": "<span class=\"neurips-year\">NeurIPS 2026</span><span class=\"neurips-track\">Main Track</span>",
    "publications.es.title": "Elastic Spectral State Space Models for Train-Once Budgeted Inference",
    "publications.es.summary":
      "One ES-SSM training run yields standalone models at several compute budgets. Ordered Hankel channels can be truncated directly; adaptive gates and budget dropout train the retained prefixes to remain predictive.",
    "publications.es.keywords": "Spectral state space models · Hankel channels · Budgeted inference",
    "publications.es.imageAlt": "Figure 1 of ES-SSM: spectral channels and compact model export",
    "publications.essh.type": "Preprint",
    "publications.essh.venue": "arXiv · 2026",
    "publications.essh.title": "Elastic Selective Spectral Hybrids for Train-Once, Export-Many Budgeted Inference",
    "publications.essh.summary":
      "ESSH makes spectral channels selective: input-dependent recurrent updates control what each channel retains. Paired with sliding-window attention, one training run yields compact language models at several sizes with fast decoding.",
    "publications.essh.keywords": "Selective spectral recurrence · Sliding-window attention · Elastic inference",
    "publications.essh.imageAlt": "Figure 1 of ESSH: selective spectral hybrid and elastic capacity axes",
    "publications.fmri.type": "Journal Article",
    "publications.fmri.venue": "Health Information Science and Systems · 2025",
    "publications.fmri.title":
      "Reconstructing brain causal dynamics for subject and task fingerprints using fMRI time-series data",
    "publications.fmri.summary":
      "Reconstructed directed interactions and fast and slow activity from fMRI, then used those causal signatures to identify subjects and tasks. A brain reachability map visualizes task-specific regional activation.",
    "publications.fmri.keywords": "fMRI · Causal dynamics · Time-series modeling · Health AI",
    "publications.bcb.type": "Conference Paper",
    "publications.bcb.venue": "ACM BCB · 2024",
    "publications.bcb.badge": "Oral Presentation",
    "publications.bcb.title": "Causality-based Subject and Task Fingerprints using fMRI Time-series Data",
    "publications.bcb.summary":
      "A two-timescale state-space model extracts directional brain interactions from fMRI. Modal features identify subjects, while a graph neural network classifies tasks.",
    "publications.bcb.keywords": "ACM BCB · Causal modeling · fMRI · Health AI",
    "publications.internship.type": "Internship",
    "publications.internship.venue": "Optosurgical · Summer 2026",
    "publications.internship.title": "Surgical Video Understanding and Efficient Depth Estimation",
    "publications.internship.role": "Machine Learning Engineer Intern",
    "publications.internship.summary":
      "Developed video models that recognize surgical phases and instrument actions, providing procedure-state cues to downstream systems. Fine-tuned a compressed Depth Anything 3 model at 29% of the original size while retaining near-full depth-estimation performance.",
    "publications.internship.keywords":
      "Surgical phase recognition · Robot-assisted surgery · Model compression · Monocular depth estimation",
    "publications.internship.imageAlt":
      "Combined non-graphic surgical grasper and clip-applier illustration beside a masked small-model depth prediction",
    "education.kicker": "Education",
    "education.title": "Academic Background.",
    "education.cv": "View CV (PDF)",
    "education.gmu.level": "Ph.D.",
    "education.gmu.school": "George Mason University",
    "education.gmu.program": "Electrical and Computer Engineering",
    "education.southampton.level": "M.Sc.",
    "education.southampton.school": "University of Southampton",
    "education.southampton.program": "Computer Science",
    "education.xju.level": "B.Eng.",
    "education.xju.school": "Xinjiang University",
    "education.xju.program": "Software Engineering",
    "awards.label": "Reviewer recognition",
    "awards.icml.line": "ICML 2026 <span class=\"highlight-badge highlight-badge-inline\">Silver Reviewer</span>",
    "awards.icml.body": "Recognized for review quality evaluated by Area Chairs.",
    "awards.service": "Reviewer for NeurIPS 2026 and AAAI 2027.",
    "contact.kicker": "Contact",
    "contact.title": "Open to collaborations across deep learning, sequence modeling, state space models, long-context modeling, efficient inference, and LLM agents.",
    "contact.email": "dsong25@gmu.edu",
  },
  zh: {
    "meta.title": "Dachuan Song | AI 研究与工程",
    "meta.description":
      "Dachuan Song 是乔治梅森大学博士研究生，研究高效序列架构、长上下文记忆与预算约束推理。",
    "language.button": "EN",
    "language.aria": "Switch to English",
    "easterEgg.coinLabel": "隐藏联系彩蛋",
    "easterEgg.dialogLabel": "微信二维码",
    "easterEgg.closeLabel": "关闭微信二维码",
    "easterEgg.qrAlt": "Dachuan Song 的微信二维码",
    "nav.about": "关于",
    "nav.skills": "技能",
    "nav.papers": "论文",
    "nav.cv": "简历",
    "nav.contact": "联系",
    "hero.eyebrow": "状态空间模型 · 长上下文 · 大语言模型智能体 · 高效推理",
    "hero.lead":
      "我研究长上下文序列模型与紧凑记忆，让模型持续利用关键信息，同时避免推理成本过高。",
    "hero.availability": "正在寻找 2027 年暑期研究实习。",
    "hero.linksLabel": "个人链接",
    "links.email": "邮箱",
    "links.emailCopyAria": "复制邮箱地址",
    "links.emailCopied": "已复制",
    "links.emailCopyFailed": "复制失败",
    "links.scholar": "学术主页",
    "profile.summaryLabel": "个人简介",
    "profile.role": "博士研究生",
    "profile.program": "电子与计算机工程",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia, USA",
    "about.kicker": "方向",
    "about.title": "状态空间模型，<br>长上下文，<br>高效推理。",
    "about.p1":
      "我是 <a class=\"direction-link\" href=\"https://www.gmu.edu/\" target=\"_blank\" rel=\"noreferrer\">乔治梅森大学</a> 电子与计算机工程博士研究生，导师为 <a class=\"direction-link\" href=\"https://mason.gmu.edu/~xwang64/index.html\" target=\"_blank\" rel=\"noreferrer\">Xuan Wang 教授</a>。<br>我研究模型如何在长序列中保留并使用信息，也关注这些能力在实际推理中的计算开销。",
    "about.p2":
      "近期工作利用有序谱通道，从一个模型导出适配不同预算的版本。我还研究输入自适应递归记忆与可合并状态，让语言模型跨片段保留证据。",
    "areas.kicker": "研究方向",
    "areas.agent.title": "可靠的大语言模型智能体",
    "areas.agent.body":
      "研究智能体记忆与信息来源追踪，让工具调用系统在持续任务中依据当前证据，而非过期上下文。",
    "areas.sequence.title": "高效长序列建模",
    "areas.sequence.body":
      "结合输入自适应的递归记忆与局部注意力，以可控的推理成本处理长序列。",
    "areas.ssm.title": "谱状态空间模型",
    "areas.ssm.body":
      "以有序谱通道作为容量维度：截取已训练模型的通道前缀，导出可独立部署的小模型。",
    "skills.kicker": "技能",
    "skills.title": "核心技术方向。",
    "skills.dl.title": "深度学习",
    "skills.dl.1": "Transformer 与注意力",
    "skills.dl.2": "基础模型适配",
    "skills.dl.3": "优化与表征学习",
    "skills.sequence.title": "长序列建模",
    "skills.sequence.1": "混合序列架构",
    "skills.sequence.2": "长度泛化",
    "skills.sequence.3": "预算约束推理",
    "skills.ssm.title": "状态空间模型",
    "skills.ssm.1": "谱状态空间模型",
    "skills.ssm.2": "线性动力系统",
    "skills.ssm.3": "高效序列算子",
    "skills.agent.title": "大语言模型智能体",
    "skills.agent.1": "工具调用智能体",
    "skills.agent.2": "智能体记忆",
    "skills.agent.3": "工作流可靠性",
    "publications.kicker": "论文",
    "publications.title": "发表文章",
    "publications.link.code": "代码",
    "publications.links.sketchops": "SketchOps 论文相关链接",
    "publications.links.es": "弹性谱状态空间模型相关链接",
    "publications.links.essh": "弹性选择性谱混合模型论文链接",
    "publications.links.fmri": "fMRI 期刊论文相关链接",
    "publications.links.bcb": "ACM BCB 会议论文相关链接",
    "publications.sketchops.type": "预印本",
    "publications.sketchops.venue": "arXiv · 2026",
    "publications.sketchops.title": "面向长上下文语言模型的可合并模型侧聚合状态",
    "publications.sketchops.summary":
      "语言模型在长历史中很难稳定完成计数和集合关系聚合。SketchOps 在冻结模型旁维护固定 2 KiB、可跨片段合并的状态；在 3,969 道聚合后推理任务上达到 99.2% 准确率，无需重读完整上下文。",
    "publications.sketchops.keywords":
      "SketchOps · HyperLogLog · 长上下文推理 · 固定预算聚合",
    "publications.es.type": "会议论文",
    "publications.es.venue": "已接收 · 海报展示",
    "publications.es.badge": "<span class=\"neurips-year\">NeurIPS 2026</span><span class=\"neurips-track\">Main Track</span>",
    "publications.es.title": "可一次训练并按预算导出的弹性谱状态空间模型",
    "publications.es.summary":
      "ES-SSM 只训练一次，就能导出适配多档计算预算的独立模型。有序 Hankel 谱通道可直接截断；自适应门控与预算丢弃训练让保留的通道前缀仍能有效预测。",
    "publications.es.keywords": "谱状态空间模型 · Hankel 谱通道 · 预算约束推理",
    "publications.es.imageAlt": "ES-SSM 图 1：谱通道与紧凑模型导出",
    "publications.essh.type": "预印本",
    "publications.essh.venue": "arXiv · 2026",
    "publications.essh.title": "用于一次训练、多预算导出的弹性选择性谱混合模型",
    "publications.essh.summary":
      "ESSH 让谱通道具备选择性：输入自适应的递归更新决定各通道保留什么信息。结合滑窗注意力，一次训练可导出多档紧凑语言模型，并保持高效解码。",
    "publications.essh.keywords": "选择性谱递归 · 滑窗注意力 · 弹性推理",
    "publications.essh.imageAlt": "ESSH 图 1：选择性谱混合架构与弹性容量维度",
    "publications.fmri.type": "期刊论文",
    "publications.fmri.venue": "Health Information Science and Systems · 2025",
    "publications.fmri.title": "使用 fMRI 时间序列数据重建用于主体和任务指纹识别的大脑因果动态",
    "publications.fmri.summary":
      "从 fMRI 重建脑区间的有向作用与快慢活动模式，再以这些因果特征识别受试者和任务。脑区可达性图展示不同任务下的区域激活范围。",
    "publications.fmri.keywords": "fMRI · 因果动态 · 时序建模 · 健康 AI",
    "publications.bcb.type": "会议论文",
    "publications.bcb.venue": "ACM BCB · 2024",
    "publications.bcb.badge": "口头报告",
    "publications.bcb.title": "基于因果性的 fMRI 时间序列主体与任务指纹识别",
    "publications.bcb.summary":
      "双时间尺度状态空间模型从 fMRI 中提取脑区间的有向作用；利用模态特征识别受试者，并用图神经网络识别任务。",
    "publications.bcb.keywords": "ACM BCB · 因果建模 · fMRI · 健康 AI",
    "publications.internship.type": "实习",
    "publications.internship.venue": "Optosurgical · 2026 夏季",
    "publications.internship.title": "手术视频理解与高效深度估计",
    "publications.internship.role": "机器学习工程师实习生",
    "publications.internship.summary":
      "用视频模型识别手术阶段与器械动作，为下游系统提供流程状态信息；将 Depth Anything 3 压缩并微调至原大小的 29%，深度估计性能接近完整模型。",
    "publications.internship.keywords":
      "手术阶段识别 · 机器人辅助手术 · 模型压缩 · 单目深度估计",
    "publications.internship.imageAlt":
      "合成的非血腥手术夹持与施夹器械示意，以及视野外区域为黑色的小模型深度预测图",
    "education.kicker": "教育",
    "education.title": "教育背景。",
    "education.cv": "查看简历（PDF）",
    "education.gmu.level": "博士",
    "education.gmu.school": "乔治梅森大学",
    "education.gmu.program": "电子与计算机工程",
    "education.southampton.level": "硕士",
    "education.southampton.school": "南安普顿大学",
    "education.southampton.program": "计算机科学",
    "education.xju.level": "本科",
    "education.xju.school": "新疆大学",
    "education.xju.program": "软件工程",
    "awards.label": "审稿荣誉",
    "awards.icml.line": "ICML 2026 <span class=\"highlight-badge highlight-badge-inline\">Silver Reviewer</span>",
    "awards.icml.body": "评审质量获得 Area Chairs 认可。",
    "awards.service": "NeurIPS 2026 与 AAAI 2027 审稿人。",
    "contact.kicker": "联系",
    "contact.title": "欢迎围绕深度学习、序列建模、状态空间模型、长上下文建模、高效推理与大语言模型智能体开展合作。",
    "contact.email": "dsong25@gmu.edu",
  },
};

const languageStorageKey = "dachuan-site-language";
const languageToggle = document.querySelector("[data-lang-toggle]");
const descriptionMeta = document.querySelector('meta[name="description"]');
const coinEasterEgg = document.querySelector("[data-coin-easter-egg]");
const wechatDialog = document.querySelector("[data-wechat-dialog]");
const wechatDialogClose = document.querySelector("[data-wechat-dialog-close]");
const emailCopyButtons = document.querySelectorAll("[data-copy-email]");
const portraitRing = document.querySelector(".portrait-ring");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let currentLanguage = "en";
let coinClickCount = 0;
const emailFeedbackTimers = new WeakMap();

const getTranslation = (language, key) => translations[language]?.[key] ?? translations.en[key] ?? "";

function setLanguage(language) {
  currentLanguage = translations[language] ? language : "en";
  document.documentElement.lang = currentLanguage === "zh" ? "zh-CN" : "en";
  document.title = getTranslation(currentLanguage, "meta.title");

  if (descriptionMeta) {
    descriptionMeta.setAttribute("content", getTranslation(currentLanguage, "meta.description"));
  }

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = getTranslation(currentLanguage, element.dataset.i18n);
  });

  document.querySelectorAll("[data-i18n-html]").forEach((element) => {
    element.innerHTML = getTranslation(currentLanguage, element.dataset.i18nHtml);
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", getTranslation(currentLanguage, element.dataset.i18nAria));
  });

  document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
    element.setAttribute("alt", getTranslation(currentLanguage, element.dataset.i18nAlt));
  });

  if (languageToggle) {
    languageToggle.textContent = getTranslation(currentLanguage, "language.button");
    languageToggle.setAttribute("aria-label", getTranslation(currentLanguage, "language.aria"));
  }

  localStorage.setItem(languageStorageKey, currentLanguage);
}

function getInitialLanguage() {
  const urlLanguage = new URLSearchParams(window.location.search).get("lang");
  const savedLanguage = localStorage.getItem(languageStorageKey);

  if (translations[urlLanguage]) return urlLanguage;
  if (translations[savedLanguage]) return savedLanguage;
  return "en";
}

document.getElementById("year").textContent = new Date().getFullYear();

if (languageToggle) {
  languageToggle.addEventListener("click", () => {
    setLanguage(currentLanguage === "en" ? "zh" : "en");
  });
}

function copyWithFallback(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) throw new Error("Clipboard copy failed");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      copyWithFallback(text);
      return;
    }
  }

  copyWithFallback(text);
}

emailCopyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const defaultKey = button.dataset.i18n;
    const existingTimer = emailFeedbackTimers.get(button);
    if (existingTimer) window.clearTimeout(existingTimer);

    try {
      await copyText(button.dataset.copyEmail);
      button.textContent = getTranslation(currentLanguage, "links.emailCopied");
      button.dataset.copyState = "success";
    } catch {
      button.textContent = getTranslation(currentLanguage, "links.emailCopyFailed");
      button.dataset.copyState = "error";
    }

    const timer = window.setTimeout(() => {
      button.textContent = getTranslation(currentLanguage, defaultKey);
      button.removeAttribute("data-copy-state");
      emailFeedbackTimers.delete(button);
    }, 1600);
    emailFeedbackTimers.set(button, timer);
  });
});

function resetPortraitInteraction() {
  if (!portraitRing) return;

  portraitRing.style.setProperty("--portrait-shadow-x", "0px");
  portraitRing.style.setProperty("--portrait-shadow-y", "7px");
  portraitRing.style.setProperty("--portrait-tilt-x", "0deg");
  portraitRing.style.setProperty("--portrait-tilt-y", "0deg");
  portraitRing.classList.remove("is-pressed");
}

if (portraitRing) {
  portraitRing.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch" || prefersReducedMotion.matches) return;

    const bounds = portraitRing.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
    const normalizedX = x * 2 - 1;
    const normalizedY = y * 2 - 1;

    portraitRing.style.setProperty("--portrait-shadow-x", `${(-normalizedX * 4).toFixed(2)}px`);
    portraitRing.style.setProperty("--portrait-shadow-y", `${(7 - normalizedY * 2).toFixed(2)}px`);
    portraitRing.style.setProperty("--portrait-tilt-x", `${(-normalizedY * 5.5).toFixed(2)}deg`);
    portraitRing.style.setProperty("--portrait-tilt-y", `${(normalizedX * 5.5).toFixed(2)}deg`);
  });

  portraitRing.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" || prefersReducedMotion.matches) return;
    portraitRing.classList.add("is-pressed");
  });

  portraitRing.addEventListener("pointerup", () => {
    portraitRing.classList.remove("is-pressed");
  });
  portraitRing.addEventListener("pointercancel", resetPortraitInteraction);
  portraitRing.addEventListener("pointerleave", resetPortraitInteraction);
}

function closeWechatDialog() {
  if (!wechatDialog) return;

  if (typeof wechatDialog.close === "function") {
    wechatDialog.close();
  } else {
    wechatDialog.removeAttribute("open");
  }

  coinEasterEgg?.setAttribute("aria-expanded", "false");
}

if (coinEasterEgg && wechatDialog) {
  coinEasterEgg.addEventListener("click", () => {
    if (wechatDialog.open) {
      closeWechatDialog();
      return;
    }

    coinClickCount += 1;

    if (coinClickCount < 5) return;

    coinClickCount = 0;
    if (typeof wechatDialog.show === "function") {
      wechatDialog.show();
    } else {
      wechatDialog.setAttribute("open", "");
    }

    coinEasterEgg.setAttribute("aria-expanded", "true");
    wechatDialogClose?.focus({ preventScroll: true });
  });

  wechatDialogClose?.addEventListener("click", closeWechatDialog);

  document.addEventListener("pointerdown", (event) => {
    if (!wechatDialog.open) return;
    if (wechatDialog.contains(event.target) || coinEasterEgg.contains(event.target)) return;
    closeWechatDialog();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !wechatDialog.open) return;
    event.preventDefault();
    closeWechatDialog();
  });

  wechatDialog.addEventListener("close", () => {
    coinClickCount = 0;
  });
}

setLanguage(getInitialLanguage());
