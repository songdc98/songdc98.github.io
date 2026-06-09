const translations = {
  en: {
    "meta.title": "Dachuan Song | AI Research & Engineering",
    "meta.description":
      "Dachuan Song is a Ph.D. student in Electrical and Computer Engineering at George Mason University working on AI, intelligent agents, long-sequence modeling, and health AI.",
    "language.button": "中文",
    "language.aria": "Switch to Chinese",
    "nav.about": "About",
    "nav.work": "Work",
    "nav.skills": "Skills",
    "nav.papers": "Papers",
    "nav.code": "Code",
    "nav.cv": "CV",
    "nav.contact": "Contact",
    "hero.eyebrow": "AI Research · Intelligent Agents · Long-Sequence Modeling · Health AI",
    "hero.lead":
      "I work across AI, intelligent agents, memory mechanisms, long-sequence modeling, and health AI, with an emphasis on clear research questions, reproducible experiments, and rigorous empirical evaluation.",
    "hero.linksLabel": "Profile links",
    "links.email": "Email",
    "links.scholar": "Scholar",
    "profile.summaryLabel": "Profile summary",
    "profile.role": "Ph.D. Student",
    "profile.program": "Electrical & Computer Engineering",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia",
    "about.kicker": "Direction",
    "about.title": "AI, Agents, and Sequence Modeling.",
    "about.p1":
      "I am a Ph.D. student at <strong>George Mason University</strong>, advised by <strong>Prof. Xuan Wang</strong>. My current interests include intelligent agents, memory mechanisms, long-context reasoning, state-space and sequence modeling.",
    "about.p2":
      "I focus on research problems where modeling ideas, implementation details, and empirical evaluation need to support each other.",
    "areas.kicker": "Research Areas",
    "areas.agent.title": "Intelligent Agents",
    "areas.agent.body":
      "Memory, tool-use reliability, long-context reasoning, and evaluation methods for models that need to plan, call tools, and avoid avoidable errors.",
    "areas.sequence.title": "Long-Sequence Modeling",
    "areas.sequence.body":
      "State-space models, spectral sequence modeling, budgeted inference, Mamba-style ideas, and mechanisms for keeping useful information over long inputs.",
    "areas.health.title": "AI for Health",
    "areas.health.body":
      "Causal and temporal modeling for fMRI, EEG, and other health data, with emphasis on interpretable signals and robust evaluation.",
    "skills.kicker": "Skills",
    "skills.title": "Technical toolkit.",
    "skills.ml.title": "Machine Learning",
    "skills.ml.1": "Linear and logistic regression",
    "skills.ml.2": "SVM, trees, and ensembles",
    "skills.ml.3": "PCA and k-means",
    "skills.ml.4": "Cross-validation and regularization",
    "skills.dl.title": "Deep Learning",
    "skills.dl.1": "CNNs and residual blocks",
    "skills.dl.2": "RNN, LSTM, and attention",
    "skills.dl.3": "Transformers and GNNs",
    "skills.dl.4": "Contrastive and triplet losses",
    "skills.sequence.title": "Sequence & Control",
    "skills.sequence.1": "State-space models",
    "skills.sequence.2": "Kalman filtering and smoothing",
    "skills.sequence.3": "AR and VAR modeling",
    "skills.sequence.4": "LQR and MPC concepts",
    "skills.agent.title": "Agents & Evaluation",
    "skills.agent.1": "Tool-use workflows",
    "skills.agent.2": "Long-context memory",
    "skills.agent.3": "Error analysis",
    "skills.agent.4": "Benchmark design",
    "skills.engineering.title": "Research Engineering",
    "skills.engineering.1": "PyTorch experiments",
    "skills.engineering.2": "CUDA-aware workflows",
    "skills.engineering.3": "Reproducible ablations",
    "skills.engineering.4": "Remote GPU execution",
    "skills.software.title": "Programming & Tools",
    "skills.software.1": "Python",
    "skills.software.2": "JavaScript and TypeScript",
    "skills.software.3": "Swift and iOS prototypes",
    "skills.software.4": "Git, Linux, and data pipelines",
    "work.kicker": "Selected Work",
    "work.title": "Research projects with measurable technical claims.",
    "work.es.time": "2026 · Preprint",
    "work.es.title": "Elastic Spectral State Space Models for Budgeted Inference",
    "work.es.body":
      "Developed ES-SSM to train once at full spectral capacity and deploy elastically by activating ordered spectral channels through masked normalization and input-adaptive spectral gating.",
    "work.es.stack": "PyTorch · CUDA · FFT convolution · Long-context benchmarks",
    "work.fmri.time": "2024–2025 · Publication line",
    "work.fmri.title": "Causal Fingerprinting from fMRI Time-Series Data",
    "work.fmri.body":
      "Reconstructed brain causal dynamics for subject and task fingerprints, connecting causal time-series modeling with interpretable neural signatures.",
    "work.fmri.stack": "fMRI · Causal dynamics · Time-series modeling · Health AI",
    "work.eeg.time": "2023 · Master project",
    "work.eeg.title": "Machine Learning for EEG Brain Activity Patterns",
    "work.eeg.body":
      "Built a deep learning pipeline combining CNN spatial extraction, LSTM temporal modeling, attention, autoencoder pretraining, and transfer learning.",
    "work.eeg.stack": "CNN · LSTM · Attention · Autoencoder · ResNet50",
    "publications.kicker": "Publications",
    "publications.title": "Published papers",
    "publications.es.title": "Elastic Spectral State Space Models for Budgeted Inference",
    "publications.fmri.title":
      "Reconstructing brain causal dynamics for subject and task fingerprints using fMRI time-series data",
    "publications.bcb.time": "ACM BCB · 2024 · Oral Presentation",
    "publications.bcb.title": "Causality-based Subject and Task Fingerprints using fMRI Time-series Data",
    "projects.kicker": "Open Code",
    "projects.title": "Open research code.",
    "projects.es.body": "Budget-aware state-space modeling with elastic spectral capacity for efficient inference.",
    "projects.health.body":
      "Local-only iOS health and training planner using personal baselines, recovery state, and workout history.",
    "projects.story.body": "English learning product concept that turns vocabulary into story-based daily practice.",
    "projects.researchCode": "Research code",
    "projects.projectPage": "Project page",
    "education.kicker": "Education & Service",
    "education.title": "Academic Background.",
    "education.gmu.degree": "Ph.D. in Electrical and Computer Engineering · 2024–Present",
    "education.gmu.body":
      "Linear systems, random processes, Kalman filtering, distributed control and optimization, system identification.",
    "education.southampton.degree": "Master's study in AI-related coursework",
    "education.southampton.body":
      "Advanced machine learning, deep learning, computer vision, Bayesian learning, active and reinforcement learning.",
    "education.service.title": "Academic Service",
    "education.service.body": "Recognized for review quality evaluated by Area Chairs.",
    "contact.kicker": "Contact",
    "contact.title": "Open to AI research engineering collaborations.",
  },
  zh: {
    "meta.title": "Dachuan Song | AI 研究与工程",
    "meta.description":
      "Dachuan Song 是 George Mason University 电子与计算机工程博士研究生，研究方向包括 AI、智能体、长序列建模和健康 AI。",
    "language.button": "EN",
    "language.aria": "Switch to English",
    "nav.about": "关于",
    "nav.work": "研究",
    "nav.skills": "技能",
    "nav.papers": "论文",
    "nav.code": "代码",
    "nav.cv": "简历",
    "nav.contact": "联系",
    "hero.eyebrow": "AI 研究 · 智能体 · 长序列建模 · 健康 AI",
    "hero.lead":
      "我的研究方向包括 AI、智能体、记忆机制、长序列建模和健康 AI，关注清晰的研究问题、可复现实验和严谨的实证评估。",
    "hero.linksLabel": "个人链接",
    "links.email": "邮箱",
    "links.scholar": "学术主页",
    "profile.summaryLabel": "个人简介",
    "profile.role": "博士研究生",
    "profile.program": "电子与计算机工程",
    "profile.university": "George Mason University",
    "profile.location": "Fairfax, Virginia",
    "about.kicker": "方向",
    "about.title": "AI、智能体与序列建模。",
    "about.p1":
      "我是 <strong>George Mason University</strong> 电子与计算机工程博士研究生，导师是 <strong>Prof. Xuan Wang</strong>。我目前关注智能体、记忆机制、长上下文推理、状态空间与序列建模。",
    "about.p2":
      "我关注建模思想、实现细节和实证评估能够相互支撑的研究问题。",
    "areas.kicker": "研究方向",
    "areas.agent.title": "智能体",
    "areas.agent.body":
      "关注记忆机制、工具使用可靠性、长上下文推理，以及让模型在规划、调用工具和避免明显错误时更可评估的方法。",
    "areas.sequence.title": "长序列建模",
    "areas.sequence.body":
      "关注状态空间模型、谱序列建模、预算推理、Mamba 相关思想，以及在长输入中保留有效信息的机制。",
    "areas.health.title": "健康 AI",
    "areas.health.body":
      "面向 fMRI、EEG 和其他健康数据的因果与时序建模，强调可解释信号和稳健评估。",
    "skills.kicker": "技能",
    "skills.title": "技术能力。",
    "skills.ml.title": "机器学习",
    "skills.ml.1": "线性与逻辑回归",
    "skills.ml.2": "SVM、树模型与集成方法",
    "skills.ml.3": "PCA 与 k-means",
    "skills.ml.4": "交叉验证与正则化",
    "skills.dl.title": "深度学习",
    "skills.dl.1": "CNN 与残差结构",
    "skills.dl.2": "RNN、LSTM 与注意力",
    "skills.dl.3": "Transformer 与 GNN",
    "skills.dl.4": "对比损失与三元组损失",
    "skills.sequence.title": "序列与控制",
    "skills.sequence.1": "状态空间模型",
    "skills.sequence.2": "卡尔曼滤波与平滑",
    "skills.sequence.3": "AR 与 VAR 建模",
    "skills.sequence.4": "LQR 与 MPC 概念",
    "skills.agent.title": "智能体与评估",
    "skills.agent.1": "工具调用流程",
    "skills.agent.2": "长上下文记忆",
    "skills.agent.3": "错误分析",
    "skills.agent.4": "基准设计",
    "skills.engineering.title": "研究工程",
    "skills.engineering.1": "PyTorch 实验",
    "skills.engineering.2": "CUDA 相关流程",
    "skills.engineering.3": "可复现实验消融",
    "skills.engineering.4": "远程 GPU 运行",
    "skills.software.title": "编程与工具",
    "skills.software.1": "Python",
    "skills.software.2": "JavaScript 与 TypeScript",
    "skills.software.3": "Swift 与 iOS 原型",
    "skills.software.4": "Git、Linux 与数据管线",
    "work.kicker": "代表工作",
    "work.title": "具有明确技术问题和可验证结果的研究项目。",
    "work.es.time": "2026 · 预印本",
    "work.es.title": "用于预算推理的弹性谱状态空间模型",
    "work.es.body":
      "提出 ES-SSM，在完整谱容量下训练一次，并通过掩码归一化和输入自适应谱门控，在部署时弹性激活有序谱通道。",
    "work.es.stack": "PyTorch · CUDA · FFT 卷积 · 长上下文基准",
    "work.fmri.time": "2024–2025 · 论文方向",
    "work.fmri.title": "基于 fMRI 时间序列的因果指纹识别",
    "work.fmri.body":
      "重建用于主体和任务指纹识别的大脑因果动态，将因果时序建模与可解释神经信号连接起来。",
    "work.fmri.stack": "fMRI · 因果动态 · 时序建模 · 健康 AI",
    "work.eeg.time": "2023 · 硕士项目",
    "work.eeg.title": "用于 EEG 脑活动模式的机器学习",
    "work.eeg.body":
      "构建结合 CNN 空间特征提取、LSTM 时序建模、注意力、自编码器预训练和迁移学习的深度学习流程。",
    "work.eeg.stack": "CNN · LSTM · 注意力 · 自编码器 · ResNet50",
    "publications.kicker": "论文",
    "publications.title": "发表文章",
    "publications.es.title": "用于预算推理的弹性谱状态空间模型",
    "publications.fmri.title": "使用 fMRI 时间序列数据重建用于主体和任务指纹识别的大脑因果动态",
    "publications.bcb.time": "ACM BCB · 2024 · 口头报告",
    "publications.bcb.title": "基于因果性的 fMRI 时间序列主体与任务指纹识别",
    "projects.kicker": "公开代码",
    "projects.title": "研究项目公开代码。",
    "projects.es.body": "面向高效推理的预算感知状态空间建模，具有弹性谱容量。",
    "projects.health.body": "本地优先的 iOS 健康与训练规划工具，结合个人基线、恢复状态和训练记录。",
    "projects.story.body": "英语学习产品概念，将词汇学习转化为故事化的每日练习。",
    "projects.researchCode": "研究代码",
    "projects.projectPage": "项目主页",
    "education.kicker": "教育与服务",
    "education.title": "教育背景。",
    "education.gmu.degree": "电子与计算机工程博士研究生 · 2024 至今",
    "education.gmu.body": "线性系统、随机过程、卡尔曼滤波、分布式控制与优化、系统辨识。",
    "education.southampton.degree": "AI 相关硕士课程学习",
    "education.southampton.body": "高级机器学习、深度学习、计算机视觉、贝叶斯学习、主动学习与强化学习。",
    "education.service.title": "学术服务",
    "education.service.body": "ICML 2026 Silver Reviewer，评审质量获得 Area Chairs 认可。",
    "contact.kicker": "联系",
    "contact.title": "欢迎交流 AI 研究工程合作。",
  },
};

const languageStorageKey = "dachuan-site-language";
const languageToggle = document.querySelector("[data-lang-toggle]");
const descriptionMeta = document.querySelector('meta[name="description"]');
let currentLanguage = "en";

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

setLanguage(getInitialLanguage());
