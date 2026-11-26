// =====================================================================
//  Pipeline DevSecOps - Atlas (BACKEND Express + FRONTEND React)
//  Etapas: Checkout -> Build -> Tests+Cobertura -> SCA || SAST
//          -> (Quality Gate SonarQube opcional) -> Imagen Docker
//          -> Deploy Staging -> Smoke Test
//  Política "Broken Build": si una etapa falla, las siguientes NO se
//  ejecutan y el despliegue queda BLOQUEADO.
// =====================================================================
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '15'))
        timeout(time: 30, unit: 'MINUTES')
    }

    triggers {
        pollSCM('H/2 * * * *')
    }

    parameters {
        booleanParam(
            name: 'EJECUTAR_SONARQUBE',
            defaultValue: false,
            description: 'Ejecutar análisis SonarQube + Quality Gate (requiere la fase opcional configurada)'
        )
    }

    environment {
        IMAGE_NAME     = 'atlas-backend'
        IMAGE_TAG      = "${env.BUILD_NUMBER}"
        STAGING_NAME   = 'atlas-staging'
        STAGING_PORT   = '8082'
        DOCKER_NETWORK = 'cicd-net'
    }

    stages {

        stage('1. Checkout') {
            steps {
                checkout scm
                sh 'git log -1 --pretty=format:"Commit %h por %an: %s%n"'
                sh 'node --version && npm --version && docker --version'
            }
        }

        stage('2. Build (dependencias y compilación)') {
            steps {
                dir('BACKEND') {
                    sh 'npm ci --no-audit --no-fund'
                    sh 'mkdir -p reports'
                }
                dir('FRONTEND') {
                    sh 'npm ci --no-audit --no-fund'
                    sh 'mkdir -p reports'
                    sh 'npm run build'
                }
            }
        }

        stage('3. Pruebas + Cobertura') {
            steps {
                dir('BACKEND') {
                    // Si un test falla o la cobertura baja del umbral => el build se rompe aquí
                    sh 'npm run test:ci'
                }
            }
            post {
                always {
                    junit allowEmptyResults: true, testResults: 'BACKEND/reports/junit.xml'
                    recordCoverage(tools: [[parser: 'COBERTURA', pattern: 'BACKEND/coverage/cobertura-coverage.xml']])
                }
            }
        }

        stage('4. Seguridad') {
            parallel {
                stage('SCA - npm audit') {
                    steps {
                        dir('BACKEND') {
                            sh 'npm audit --json > reports/npm-audit.json || true'
                            sh 'npm run audit:gate'
                        }
                        dir('FRONTEND') {
                            sh 'npm audit --json > reports/npm-audit.json || true'
                            sh 'npm audit --omit=dev --audit-level=high'
                        }
                    }
                }
                stage('SAST - ESLint') {
                    steps {
                        dir('FRONTEND') {
                            sh 'npx eslint . -f html -o reports/sast-eslint.html || true'
                            sh 'npm run lint'
                        }
                    }
                }
            }
        }

        stage('5. Quality Gate SonarQube (opcional)') {
            when {
                expression { return params.EJECUTAR_SONARQUBE }
            }
            steps {
                script {
                    def scannerHome = tool 'SonarScanner'
                    withSonarQubeEnv('SonarQube') {
                        sh "${scannerHome}/bin/sonar-scanner"
                    }
                }
                timeout(time: 5, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('6. Build imagen Docker') {
            steps {
                sh 'docker info > /dev/null'
                sh 'docker network inspect ${DOCKER_NETWORK} > /dev/null'
                sh 'docker build -t ${IMAGE_NAME}:${IMAGE_TAG} -t ${IMAGE_NAME}:latest BACKEND'
                sh 'docker image inspect ${IMAGE_NAME}:${IMAGE_TAG} --format="Imagen creada: {{.Id}}"'
            }
        }

        stage('7. Deploy a Staging') {
            steps {
                sh '''
                    docker rm -f ${STAGING_NAME} 2>/dev/null || true
                    docker run -d \
                        --name ${STAGING_NAME} \
                        --network ${DOCKER_NETWORK} \
                        -p ${STAGING_PORT}:3000 \
                        -e PORT=3000 \
                        --restart unless-stopped \
                        --label laboratorio=atlas-cicd \
                        ${IMAGE_NAME}:${IMAGE_TAG}

                    test "$(docker inspect -f '{{.State.Running}}' ${STAGING_NAME})" = "true"
                    docker ps --filter "name=^/${STAGING_NAME}$"
                '''
            }
        }

        stage('8. Smoke Test') {
            steps {
                sh '''
                    intentos=0
                    until curl -fsS "http://${STAGING_NAME}:3000/health"; do
                        intentos=$((intentos + 1))
                        if [ "$intentos" -ge 15 ]; then
                            echo "ERROR: la API no respondió después de 30 segundos."
                            docker inspect ${STAGING_NAME} --format 'status={{.State.Status}} exit={{.State.ExitCode}}'
                            docker logs --tail 100 ${STAGING_NAME}
                            exit 1
                        fi
                        echo "API iniciando... intento ${intentos}/15"
                        sleep 2
                    done
                    echo
                    curl -fsS "http://${STAGING_NAME}:3000/" > /dev/null
                '''
                echo "Aplicación disponible en http://localhost:${STAGING_PORT}/health"
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'BACKEND/reports/**, FRONTEND/reports/**, BACKEND/coverage/cobertura-coverage.xml', allowEmptyArchive: true
        }
        success {
            echo "PIPELINE OK: build #${env.BUILD_NUMBER} desplegado en staging (imagen ${IMAGE_NAME}:${IMAGE_TAG})."
        }
        failure {
            echo "PIPELINE FALLIDO: build #${env.BUILD_NUMBER} BLOQUEADO. Revisa la etapa en rojo; NO se desplegó a staging."
            sh 'docker ps -a --filter "name=^/${STAGING_NAME}$" || true'
            sh 'docker logs --tail 100 ${STAGING_NAME} 2>/dev/null || true'
        }
    }
}
