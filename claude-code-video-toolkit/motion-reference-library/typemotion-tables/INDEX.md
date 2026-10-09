# 动画参考文字索引

先按本期表达需求检索、阅读候选说明，再看候选分镜图；需要运动细节才看视频。不一次加载全部源码。

|案例|适合表达|动作摘要|说明|
|---|---|---|---|
|单元格扫描|表格、数值、对比|四行文字按顺序显露，scan 通过离散行索引切换浅色背景强调；强调不是平滑滑动。|[cell-highlight](cases/cell-highlight/README.md)|
|折线趋势|趋势、时间、增长|折线沿既有点列逐渐画出，节点和数字分批显露；末段淡入解释标注。|[line-trend](cases/line-trend/README.md)|
|双线比较|趋势、比较、交叉|两条趋势线错开开始绘制，各自节点与数字分批显露，最后显示交叉说明。|[comparison-lines](cases/comparison-lines/README.md)|
|分组柱状图|类别、多系列、比较|各柱按类别错开增长；多系列再按系列错开。分组柱并列增长，堆叠柱以上一段当前高度为下一段基线。|[clustered-column](cases/clustered-column/README.md)|
|堆叠柱状图|构成、总量、多系列|各柱按类别错开增长；多系列再按系列错开。分组柱并列增长，堆叠柱以上一段当前高度为下一段基线。|[stacked-column](cases/stacked-column/README.md)|
|动态条形排名|排序、时间、超越|建立完成后，start 逐渐过渡到 end；横条长度、数字与行位置随 change 同步改变。|[bar-race](cases/bar-race/README.md)|
|动态榜单|排名、超越、榜单|建立完成后，start 逐渐过渡到 end；横条长度、数字与行位置随 change 同步改变。|[ranking-rise](cases/ranking-rise/README.md)|
|桑基流向|流向、分配、转化|六条弯曲流带按顺序从左端向右端展开；最后显露总量说明。|[sankey-flow](cases/sankey-flow/README.md)|
|商务桑基图|流向、商务、分配|六条弯曲流带按顺序从左端向右端展开；最后显露总量说明。|[sankey-mckinsey](cases/sankey-mckinsey/README.md)|
|复古桑基图|流向、分配、高对比|六条弯曲流带按顺序从左端向右端展开；最后显露总量说明。|[sankey-retro](cases/sankey-retro/README.md)|
|基础饼图|占比、构成|五个扇区按顺序展开各自角度，扇区百分数同步渐显，右侧图例随后逐行进入。|[pie-basic](cases/pie-basic/README.md)|
|符号饼图|占比、概览、符号|五个扇区逐个展开，中心用背景圆挖空并保留符号，右侧图例逐行显露。中心符号不旋转。|[pie-symbol](cases/pie-symbol/README.md)|
|百分比堆叠柱|占比、构成、比较|每组 vals 除以本组 sum 归一为100%，三段按不同窗口自下而上累积。|[percent-stacked](cases/percent-stacked/README.md)|
|蝴蝶对比条|两组、对比、镜像|两组条分别从中间左右两侧向外延长，同一行一起显露；两端显示目标数值，不滚动计数。|[butterfly-bar](cases/butterfly-bar/README.md)|
|进度条|进度、目标、完成率|六行依次渐显，彩色条从零延长，旁侧百分数随条长计数；灰色全长条保持不动。|[progress-bars](cases/progress-bars/README.md)|
|矩阵热力图|矩阵、强弱、分布|六行五列单元格按行列错开显露，以颜色透明度表达值；随后逐格切换数字粗细以转移关注。|[cartesian-heatmap](cases/cartesian-heatmap/README.md)|
|商务热力图|矩阵、商务、分布|六行五列单元格按行列错开显露，以颜色透明度表达值；随后逐格切换数字粗细以转移关注。|[heatmap-mckinsey](cases/heatmap-mckinsey/README.md)|
|复古热力图|矩阵、高对比、分布|六行五列单元格按行列错开显露，以颜色透明度表达值；随后逐格切换数字粗细以转移关注。|[heatmap-retro](cases/heatmap-retro/README.md)|
|矩形树图|面积、构成、份额|各矩形围绕自身中心从85%比例放大至完整大小，同时渐显，类别和占比随矩形一起进入。|[treemap-single](cases/treemap-single/README.md)|
|玫瑰图|极坐标、周期、强弱|五个等角扇区依次增长半径，目标半径按数值平方根计算，使面积随值变化；右侧图例逐行显露。|[polar-rose](cases/polar-rose/README.md)|
|开放同心环|进度、多指标、排序|五条同心弧按顺序延长，每条有独立延迟和对应目标完成比例，底部保留开放缺口。|[jade-ring](cases/jade-ring/README.md)|
|弦关系图|关系、连接、多向|六条内部弦带错开渐显，逐步建立交织关系；弦带没有沿路径流动或动态拉伸。|[chord-flow](cases/chord-flow/README.md)|
|复古弦图|关系、多向、高对比|六条内部弦带错开渐显，逐步建立交织关系；弦带没有沿路径流动或动态拉伸。|[chord-retro](cases/chord-retro/README.md)|
|数值计数器|指标、KPI、增长|中心数字随 build 计数到128450；detail 阶段涨幅渐显，同时绘制下方趋势线。|[number-count](cases/number-count/README.md)|
|仪表盘概览|概览、KPI、多图|五个分区交错从左右滑入并渐显；三项指标显露后，detail 同时画出趋势线并增长右侧四条指标条。|[dashboard-snapshot](cases/dashboard-snapshot/README.md)|
|面积趋势|趋势、规模、面积|面积区域随 build 横向揭示，折线沿点列画出，节点读数按独立窗口出现，最后淡入解释标注。|[area-chart](cases/area-chart/README.md)|
|散点分布|分布、相关、异常|各点按顺序从底部移到各自目标位置，同时放大；detail 阶段描出示意趋势线并显示说明。|[scatter-plot](cases/scatter-plot/README.md)|
|漏斗转化|流程、转化、流失|各层按顺序从上方少量位移落到位置并渐显，层内百分数随进度计数。|[funnel-flow](cases/funnel-flow/README.md)|
|市场矩形树图|市场、面积、涨跌|五块矩形缩放显露后，scan 阶段补充涨跌百分数。块颜色按示例索引设置，并未按真实涨跌值计算。|[treemap-market](cases/treemap-market/README.md)|
|扇区揭示|占比、重点、分离|先逐个展开五个扇区，随后 focus 将第一扇区沿角平分线推出22单位，其百分数与图形一起位移。|[pie-slice](cases/pie-slice/README.md)|
|占比圆环|占比、圆环、重点|五个扇区依次展开，中心背景圆形成圆环；中心占比随 build 计数，右侧图例逐行进入。|[share-donut](cases/share-donut/README.md)|
|瀑布增减桥|增减、贡献、总量|柱形依次增长，正增量向上、负增量从当前累计水平向下建立；连接虚线及读数随该柱显露，最后显示终点柱。|[waterfall-bridge](cases/waterfall-bridge/README.md)|
|柱线组合|趋势、比较、组合|柱形先错开增长；随后 detail 控制折线绘制与解释显露。折线节点仍按独立窗口显露，移用时应校准其与线头的关系。|[combo-chart](cases/combo-chart/README.md)|
|横向指标条|指标、长标签、比较|六行依次从左侧少量平移进入并渐显，同时横条延长、数字计数；到达后固定不动。|[horizontal-bar-metrics](cases/horizontal-bar-metrics/README.md)|
|柱状天际线|密集、序列、柱形|18根柱按横向顺序错开从同一基线增长，柱高由示例公式计算。|[bar-skyline](cases/bar-skyline/README.md)|
|分段日记录|时间、分段、日记录|各天、各组成部分依次错开从底部增长，上层基线随下层当前高度累计；窗口裁切为圆角形状。|[sleep-tracker](cases/sleep-tracker/README.md)|
|折线转雷达|多维、变形、对比|morph 将六个点及标签移动到各自雷达轴方向，同时显露网格；fill 阶段补上闭合边并显露面积填充。|[radar-morph](cases/radar-morph/README.md)|
|分屏图表|概览、分屏、多图|四块分区交错滑入并渐显；每区标签读数逐个出现，detail 同时推动折线、柱形、圆弧与增长读数。|[grid-chart-split](cases/grid-chart-split/README.md)|
|堆叠层叠|层次、顺序、构成|按底层到顶层的顺序向上进入目标位置并渐显；标签、百分数与矩形共同移动。|[stacked-cascade](cases/stacked-cascade/README.md)|
|多层圆环|多指标、进度、圆环|三条同心环按顺序延长，中心数字随 build 计数到核心指标，右侧三行图例依次显露。|[stacked-donut](cases/stacked-donut/README.md)|
|网络关系|关系、网络、传播|连线从节点边缘逐条画出；detail 阶段小圆点沿连接从起点移向终点，阶段结束后消失。|[network-map](cases/network-map/README.md)|
|数据叙事板|洞察、趋势、叙事|两个主面板进入；左侧洞察标题显露后，detail 同时显示增幅、绘制右侧趋势线并显露下方口径说明。|[data-story-board](cases/data-story-board/README.md)|
|网格搭建|表格、网格、建立|先延展网格与显露表头，再逐行填入数据；scan 期间浅色强调底在行间离散切换。|[grid-build](cases/grid-build/README.md)|
