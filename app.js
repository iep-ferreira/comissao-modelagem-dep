// Variáveis globais
let jsonData = [];
let docentesList = [];
let nDocentes = 0;

// Parâmetros iniciais
let betasTeo = [1.0, 0.0092, 0.062, 0.005];
let tTeo = [20, 60];

let betasPrat = [1.0, 0.037, 0.096, 0.005];
let tPrat = [20, 40];

// Função para ler o arquivo Excel
document.getElementById('fileUpload').addEventListener('change', handleFile, false);

function handleFile(e) {
    const files = e.target.files;
    const reader = new FileReader();
    reader.onload = function(event) {
        const data = event.target.result;
        const workbook = XLSX.read(data, {type: 'binary'});
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        jsonData = XLSX.utils.sheet_to_json(worksheet, {defval: ''});
        processData();
    };
    reader.readAsBinaryString(files[0]);
}

// Função para processar os dados
function processData() {
    if (jsonData.length === 0) {
        alert('Nenhum dado disponível.');
        return;
    }

    // Obter lista de docentes
    docentesList = [...new Set(jsonData.map(d => d['N_UFSCar']))];
    nDocentes = docentesList.length;

    // Atualizar gráficos e tabela
    updateAll();
}

// Função eta_function
function etaFunction(x, betas, t) {
    const d1 = betas[2] - betas[1];
    const d2 = betas[3] - betas[2];
    const y = betas[0] + betas[1]*x + d1*Math.log(Math.exp((x - t[0])/1) + 1) + d2*Math.log(Math.exp((x - t[1])/1) + 1);
    return y;
}

// Função cal_esf
function calEsf(params) {
    const { ch, calendario, curso, adjusted, percapita } = params;

    // Coeficientes
    const coefFormula1 = { betas: betasTeo, t: tTeo };
    const coefFormula2 = { betas: betasPrat, t: tPrat };

    // Filtrar dados
    let dados = jsonData.filter(d => d['Numero de Inscritos'] > 0);
    dados = dados.filter(d => d['Area'] === curso);

    const dadosEnsino = dados.filter(d => !['TCC Curso Presencial', 'Estágio Curso Presencial'].includes(d['Tipo de Atividade Curricular']));
    const dadosEstagio = dados.filter(d => d['Tipo de Atividade Curricular'] === 'Estágio Curso Presencial');

    // Pesos teóricos e práticos
    const pesosTeoricos = dadosEnsino.map(d => etaFunction(d['Numero de Inscritos'], coefFormula1.betas, coefFormula1.t));
    const pesosPraticos = dadosEnsino.map(d => etaFunction(d['Numero de Inscritos'], coefFormula2.betas, coefFormula2.t));

    // Peso estágio
    const pesoEstagio = dadosEstagio.map(d => {
        if (!d['Grupo']) return 0;
        let pesoGrupo = 0;
        if (d['Grupo'] == 1) pesoGrupo = 0.2;
        else if (d['Grupo'] == 2) pesoGrupo = 0.5;
        else pesoGrupo = 1.0;
        return pesoGrupo * etaFunction(d['Numero de Inscritos'], coefFormula2.betas, coefFormula2.t);
    });

    // Créditos teóricos
    let creditosTeoricos = dadosEnsino.map((d, i) => {
        let ch = (d['Carga Horaria - Teorica'] || 0) * 15 * (d['Carga Horaria do Docente (%)'] / 100);
        if (adjusted) ch *= pesosTeoricos[i];
        return { docente: d['N_UFSCar'], ch };
    });

    // Créditos práticos
    let creditosPraticos = dadosEnsino.map((d, i) => {
        let chPratica = ((d['Carga Horaria - Pratica (como componente curricular)'] || 0) + (d['Carga Horaria - Pratica'] || 0)) * 15 * (d['Carga Horaria do Docente (%)'] / 100);
        if (adjusted) chPratica *= pesosPraticos[i];
        return { docente: d['N_UFSCar'], ch: chPratica };
    });

    // Créditos estágio
    let creditosEstagio = dadosEstagio.map((d, i) => {
        let chEstagio = (d['Carga Horaria - Total'] || 0) * 15 * (d['Carga Horaria do Docente (%)'] / 100);
        if (adjusted) chEstagio *= pesoEstagio[i];
        return { docente: d['N_UFSCar'], ch: chEstagio };
    });

    // Agregar créditos por docente
    let tabela = {};

    // Inicializar docentes
    docentesList.forEach(docente => {
        tabela[docente] = 0;
    });

    // Somar créditos
    function somarCreditos(creditos) {
        creditos.forEach(item => {
            tabela[item.docente] += item.ch;
        });
    }

    if (ch === 'teoria') {
        tabela = {};
        creditosTeoricos.forEach(item => {
            if (!tabela[item.docente]) tabela[item.docente] = 0;
            tabela[item.docente] += item.ch;
        });
    } else if (ch === 'pratica') {
        tabela = {};
        creditosPraticos.forEach(item => {
            if (!tabela[item.docente]) tabela[item.docente] = 0;
            tabela[item.docente] += item.ch;
        });
    } else if (ch === 'estagio') {
        tabela = {};
        creditosEstagio.forEach(item => {
            if (!tabela[item.docente]) tabela[item.docente] = 0;
            tabela[item.docente] += item.ch;
        });
    } else if (ch === 'total') {
        somarCreditos(creditosTeoricos);
        somarCreditos(creditosPraticos);
        somarCreditos(creditosEstagio);
    }

    // Per capita
    if (percapita) {
        for (let docente in tabela) {
            tabela[docente] = tabela[docente] / nDocentes;
        }
    }

    // Converter em array
    let tabelaArray = [];
    for (let docente in tabela) {
        tabelaArray.push({ docente, esforco: parseFloat(tabela[docente].toFixed(1)) });
    }

    // Ordenar por esforço decrescente
    tabelaArray.sort((a, b) => b.esforco - a.esforco);

    return tabelaArray;
}

// Função para atualizar os gráficos e a tabela
function updateAll() {
    const params = {
        ch: $('#ch').val(),
        calendario: $('#calendario').val(),
        curso: $('#curso').val(),
        adjusted: $('#adjusted').is(':checked'),
        percapita: $('#percapita').is(':checked')
    };

    const tabela = calEsf(params);

    // Atualizar gráfico de barras
    updatePlot(tabela, params);

    // Atualizar tabela
    updateTable(tabela);

    // Atualizar gráficos da função eta
    plotEtaTeo();
    plotEtaPrat();
}

// Função para atualizar o gráfico de barras
function updatePlot(data, params) {
    const x = data.map(d => d.docente);
    const y = data.map(d => d.esforco);

    let labelY = '';
    if (params.adjusted && params.percapita) {
        labelY = 'Esforço docente ajustado per capita (h)';
    } else if (params.adjusted && !params.percapita) {
        labelY = 'Esforço docente ajustado total (h)';
    } else if (!params.adjusted && params.percapita) {
        labelY = 'Esforço docente per capita sem ajuste (h)';
    } else {
        labelY = 'Esforço docente sem ajuste total (h)';
    }

    const trace = {
        x: x,
        y: y,
        type: 'bar'
    };

    const layout = {
        title: 'Resultado',
        xaxis: { title: 'Docentes', type: 'category' }, // Garantir que x é categórico
        yaxis: { title: labelY },
        shapes: [
            {
                type: 'line',
                x0: -0.5,
                y0: quantile(y, 0.15),
                x1: x.length - 0.5,
                y1: quantile(y, 0.15),
                line: { dash: 'dashdot', color: 'red' }
            },
            {
                type: 'line',
                x0: -0.5,
                y0: quantile(y, 0.85),
                x1: x.length - 0.5,
                y1: quantile(y, 0.85),
                line: { dash: 'dashdot', color: 'green' }
            }
        ]
    };

    Plotly.newPlot('bar_plot', [trace], layout);
}

// Função para atualizar a tabela
function updateTable(data) {
    $('#data_table').DataTable({
        data: data,
        columns: [
            { data: 'docente' },
            { data: 'esforco' }
        ],
        destroy: true,
        pageLength: 10,
        order: [[1, 'desc']]
    });
}

// Função para calcular quantis
function quantile(arr, q) {
    const sorted = arr.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
}

// Função para plotar a função eta teórica
function plotEtaTeo() {
    const x = [];
    const y = [];
    for (let i = 1; i <= 100; i++) {
        x.push(i);
        y.push(etaFunction(i, betasTeo, tTeo));
    }

    // Ponto de equivalência
    const valorEq = etaFunction(30, betasTeo, tTeo);

    const trace = {
        x: x,
        y: y,
        mode: 'lines',
        line: { color: 'red' },
        name: 'Fator de esforço docente'
    };

    const traceEqPoints = {
        x: [30, 60],
        y: [valorEq, 2 * valorEq],
        mode: 'markers',
        marker: { color: 'blue', size: 10 },
        name: 'Pontos de Equivalência'
    };

    const layout = {
        title: 'Fator de esforço docente vs Número de alunos (Teórico)',
        xaxis: { title: 'Número de alunos' },
        yaxis: { title: 'Fator de esforço docente', range: [0, 5] },
        shapes: [
            {
                type: 'line',
                x0: 0,
                y0: 5,
                x1: 100,
                y1: 5,
                line: { dash: 'dashdot', color: 'grey', width: 4 }
            }
        ],
        annotations: [
            {
                x: 10,
                y: 5.1,
                xref: 'x',
                yref: 'y',
                text: 'MAX SUGERIDO',
                showarrow: false,
                font: { size: 12 }
            }
        ]
    };

    Plotly.newPlot('plot_eta_teo', [trace, traceEqPoints], layout);
}

// Função para plotar a função eta prática
function plotEtaPrat() {
    const x = [];
    const y = [];
    for (let i = 1; i <= 100; i++) {
        x.push(i);
        y.push(etaFunction(i, betasPrat, tPrat));
    }

    // Valor de equivalência da função teórica
    const valorEqTeo = etaFunction(30, betasTeo, tTeo);

    const trace = {
        x: x,
        y: y,
        mode: 'lines',
        line: { color: 'blue' },
        name: 'Fator de esforço docente'
    };

    const traceEqPoints = {
        x: [20, 40],
        y: [valorEqTeo, 2 * valorEqTeo],
        mode: 'markers',
        marker: { color: 'red', size: 10 },
        name: 'Pontos de Equivalência'
    };

    const layout = {
        title: 'Fator de esforço docente vs Número de alunos (Prático)',
        xaxis: { title: 'Número de alunos' },
        yaxis: { title: 'Fator de esforço docente', range: [0, 5] },
        shapes: [
            {
                type: 'line',
                x0: 0,
                y0: 5,
                x1: 100,
                y1: 5,
                line: { dash: 'dashdot', color: 'grey', width: 4 }
            }
        ],
        annotations: [
            {
                x: 10,
                y: 5.1,
                xref: 'x',
                yref: 'y',
                text: 'MAX SUGERIDO',
                showarrow: false,
                font: { size: 12 }
            }
        ]
    };

    Plotly.newPlot('plot_eta_prat', [trace, traceEqPoints], layout);
}

// Inicializar sliders
function initSliders() {
    // Parâmetros teóricos
    noUiSlider.create(document.getElementById('b1_teo_slider'), {
        start: 0.0092,
        range: { min: 0, max: 0.02 },
        step: 0.0001
    });
    document.getElementById('b1_teo_slider').noUiSlider.on('update', function(values) {
        betasTeo[1] = parseFloat(values[0]);
        $('#b1_teo_val').text(values[0]);
        updateAll();
    });

    noUiSlider.create(document.getElementById('b2_teo_slider'), {
        start: 0.062,
        range: { min: 0, max: 0.15 },
        step: 0.001
    });
    document.getElementById('b2_teo_slider').noUiSlider.on('update', function(values) {
        betasTeo[2] = parseFloat(values[0]);
        $('#b2_teo_val').text(values[0]);
        updateAll();
    });

    noUiSlider.create(document.getElementById('b3_teo_slider'), {
        start: 0.005,
        range: { min: 0, max: 0.05 },
        step: 0.0001
    });
    document.getElementById('b3_teo_slider').noUiSlider.on('update', function(values) {
        betasTeo[3] = parseFloat(values[0]);
        $('#b3_teo_val').text(values[0]);
        updateAll();
    });

    noUiSlider.create(document.getElementById('t1_teo_slider'), {
        start: 20,
        range: { min: 1, max: 30 },
        step: 1
    });
    document.getElementById('t1_teo_slider').noUiSlider.on('update', function(values) {
        tTeo[0] = parseInt(values[0]);
        $('#t1_teo_val').text(values[0]);
        updateAll();
    });

    noUiSlider.create(document.getElementById('t2_teo_slider'), {
        start: 60,
        range: { min: 31, max: 80 },
        step: 1
    });
    document.getElementById('t2_teo_slider').noUiSlider.on('update', function(values) {
        tTeo[1] = parseInt(values[0]);
        $('#t2_teo_val').text(values[0]);
        updateAll();
    });

    // Parâmetros práticos
    noUiSlider.create(document.getElementById('b1_prat_slider'), {
        start: 0.037,
        range: { min: 0, max: 0.08 },
        step: 0.0001
    });
    document.getElementById('b1_prat_slider').noUiSlider.on('update', function(values) {
        betasPrat[1] = parseFloat(values[0]);
        $('#b1_prat_val').text(values[0]);
        updateAll();
    });

    noUiSlider.create(document.getElementById('b2_prat_slider'), {
        start: 0.096,
        range: { min: 0, max: 0.20 },
        step: 0.001
    });
    document.getElementById('b2_prat_slider').noUiSlider.on('update', function(values) {
        betasPrat[2] = parseFloat(values[0]);
        $('#b2_prat_val').text(values[0]);
        updateAll();
    });

    noUiSlider.create(document.getElementById('b3_prat_slider'), {
        start: 0.005,
        range: { min: 0, max: 0.05 },
        step: 0.0001
    });
    document.getElementById('b3_prat_slider').noUiSlider.on('update', function(values) {
        betasPrat[3] = parseFloat(values[0]);
        $('#b3_prat_val').text(values[0]);
        updateAll();
    });

    noUiSlider.create(document.getElementById('t1_prat_slider'), {
        start: 20,
        range: { min: 1, max: 30 },
        step: 1
    });
    document.getElementById('t1_prat_slider').noUiSlider.on('update', function(values) {
        tPrat[0] = parseInt(values[0]);
        $('#t1_prat_val').text(values[0]);
        updateAll();
    });

    noUiSlider.create(document.getElementById('t2_prat_slider'), {
        start: 40,
        range: { min: 31, max: 50 },
        step: 1
    });
    document.getElementById('t2_prat_slider').noUiSlider.on('update', function(values) {
        tPrat[1] = parseInt(values[0]);
        $('#t2_prat_val').text(values[0]);
        updateAll();
    });
}

// Event listeners
$('#ch, #calendario, #curso, #adjusted, #percapita').on('change', updateAll);

// Inicializar sliders
initSliders();
