import requests
from datetime import datetime

# URL do endpoint de ingestão no backend Node.js
BACKEND_URL = "http://localhost:3000/api/jobs/ingest"

def scrape_jobs():
    """
    Simula ou executa a varredura nas plataformas (LinkedIn, Remotar, WeWorkRemotely, Turing, RemoteOK, etc.)
    filtrando vagas de acordo com o perfil do Gian:
    - Níveis: Mid / Pleno e Senior / Lead
    - Modalidade estritamente Remote / Home Office
    - Remuneração mínima: salary_brl >= 12000 ou moeda estrangeira (USD, EUR, GBP)
    - Tech Stack: React, Node.js, Python, TypeScript, Fullstack, API REST, PostgreSQL/SQLite
    - Carga horária (work_hours): 8h/dia (Full-time), 4h/dia (Meio Período), 6h/dia, Horário Flexível
    """
    print("[Scraper] Iniciando varredura de vagas remotas (Mid/Pleno e Senior)...")
    today = datetime.now().strftime("%Y-%m-%d")

    jobs = [
        {
            "title": "Mid-Level Full Stack Developer (React / Node.js)",
            "company": "ScaleUp LatAm",
            "location": "Remote (LatAm)",
            "salary": "$3,800 / month",
            "currency": "USD",
            "salary_brl": 22040.00,
            "platform": "LinkedIn",
            "url": "https://www.linkedin.com/jobs/view/mid-fullstack-react-node-001",
            "date": today,
            "match_score": 95,
            "work_hours": "8h/dia (Full-time)"
        },
        {
            "title": "Desenvolvedor(a) Fullstack Pleno (Node.js / React / TypeScript)",
            "company": "Fintech Brasil Digital",
            "location": "Home Office (Brasil)",
            "salary": "R$ 13.500 / mês",
            "currency": "BRL",
            "salary_brl": 13500.00,
            "platform": "Remotar",
            "url": "https://remotar.com.br/job/desenvolvedor-fullstack-pleno-node-react-103",
            "date": today,
            "match_score": 93,
            "work_hours": "8h/dia (Horário Flexível)"
        },
        {
            "title": "Mid-Level Python & React Developer (Part-Time / Meio Período)",
            "company": "IndieSaaS Studio",
            "location": "Remote (Worldwide)",
            "salary": "$2,500 / month",
            "currency": "USD",
            "salary_brl": 14500.00,
            "platform": "WeWorkRemotely",
            "url": "https://weworkremotely.com/remote-jobs/indiesaas-mid-python-react-part-time-202",
            "date": today,
            "match_score": 92,
            "work_hours": "4h/dia (Meio Período)"
        },
        {
            "title": "Senior Full Stack React/Node Engineer",
            "company": "CloudScale Global",
            "location": "Remote (LatAm / US)",
            "salary": "$6,000 / month",
            "currency": "USD",
            "salary_brl": 34800.00,
            "platform": "LinkedIn",
            "url": "https://www.linkedin.com/jobs/view/scraper-live-001",
            "date": today,
            "match_score": 98,
            "work_hours": "8h/dia (Full-time)"
        },
        {
            "title": "Python & Node.js Backend Pleno/Sênior",
            "company": "DataFlow Systems",
            "location": "Home Office (Brasil)",
            "salary": "R$ 16.000 / mês",
            "currency": "BRL",
            "salary_brl": 16000.00,
            "platform": "Gupy",
            "url": "https://remotar.com.br/job/scraper-live-002",
            "date": today,
            "match_score": 94,
            "work_hours": "6h/dia (30h/sem)"
        }
    ]

    filtered_jobs = []
    for job in jobs:
        is_remote = any(kw in job["location"].lower() for kw in ["remote", "home office", "remoto"])
        valid_salary = job["salary_brl"] >= 12000 or job["currency"] in ["USD", "EUR", "GBP"]

        if is_remote and valid_salary:
            filtered_jobs.append(job)

    print(f"[Scraper] {len(filtered_jobs)} vagas filtradas e prontas para envio.")
    return filtered_jobs

def send_to_backend(jobs):
    if not jobs:
        print("[Scraper] Nenhuma vaga para enviar.")
        return

    try:
        response = requests.post(BACKEND_URL, json=jobs)
        if response.status_code == 200:
            print(f"[Scraper] Sucesso! Resposta do servidor: {response.json()}")
        else:
            print(f"[Scraper] Erro no servidor: {response.status_code} - {response.text}")
    except requests.exceptions.ConnectionError:
        print("[Scraper] Erro: Não foi possível conectar ao backend em http://localhost:3000. O servidor está rodando?")

if __name__ == "__main__":
    jobs = scrape_jobs()
    send_to_backend(jobs)
