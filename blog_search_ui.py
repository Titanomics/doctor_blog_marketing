"""
네이버 블로그 검색 순위 확인 프로그램 - PySide6 UI
파스텔톤 브라운 계열 디자인 / Pretendard 폰트
"""

import sys
import urllib.request
import urllib.parse
import json
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout,
    QHBoxLayout, QLabel, QLineEdit, QPushButton,
    QTableWidget, QTableWidgetItem, QHeaderView, QMessageBox
)
from PySide6.QtCore import Qt, QThread, Signal, QUrl
from PySide6.QtGui import QFont, QColor, QFontDatabase, QDesktopServices

# API 인증 정보 (사용자가 직접 입력)
CLIENT_ID = ""
CLIENT_SECRET = ""


class SearchThread(QThread):
    """검색을 별도 스레드에서 실행"""
    finished = Signal(list)  # 검색 결과 리스트
    error = Signal(str)  # 에러 메시지

    def __init__(self, keyword, target_url):
        super().__init__()
        self.keyword = keyword
        self.target_url = target_url

    def run(self):
        """검색 실행"""
        try:
            results = self.search_all_results(self.keyword, self.target_url)
            self.finished.emit(results)
        except Exception as e:
            self.error.emit(f"검색 중 오류 발생: {str(e)}")

    def search_all_results(self, keyword, target_url):
        """모든 검색 결과 가져오기 (최대 100개)"""
        results = []
        max_results = 100
        display_per_page = 100

        enc_keyword = urllib.parse.quote(keyword)

        for start in range(1, max_results + 1, display_per_page):
            url = f"https://openapi.naver.com/v1/search/blog?query={enc_keyword}&display={display_per_page}&start={start}"

            request = urllib.request.Request(url)
            request.add_header("X-Naver-Client-Id", CLIENT_ID)
            request.add_header("X-Naver-Client-Secret", CLIENT_SECRET)

            response = urllib.request.urlopen(request)
            rescode = response.getcode()

            if rescode == 200:
                response_body = response.read()
                result = json.loads(response_body.decode('utf-8'))

                if 'items' in result and len(result['items']) > 0:
                    for idx, item in enumerate(result['items']):
                        rank = start + idx
                        title = item['title'].replace('<b>', '').replace('</b>', '')
                        link = item['link']

                        # 목표 URL과 일치하는지 확인
                        normalized_target = target_url.replace('http://', '').replace('https://', '').replace('www.', '')
                        normalized_blog = link.replace('http://', '').replace('https://', '').replace('www.', '')
                        is_match = normalized_target in normalized_blog or normalized_blog in normalized_target

                        results.append({
                            'rank': rank,
                            'title': title,
                            'link': link,
                            'is_match': is_match
                        })

                    if len(result['items']) < display_per_page:
                        break
                else:
                    break
            else:
                raise Exception(f"API Error Code: {rescode}")

        return results


class BlogSearchUI(QMainWindow):
    """블로그 검색 UI 메인 윈도우"""

    def __init__(self):
        super().__init__()
        self.search_thread = None
        self.init_ui()

    def init_ui(self):
        """UI 초기화"""
        self.setWindowTitle("네이버 블로그 검색 순위 확인")
        self.setGeometry(100, 100, 1000, 700)

        # 중앙 위젯
        central_widget = QWidget()
        self.setCentralWidget(central_widget)

        # 메인 레이아웃
        main_layout = QVBoxLayout()
        main_layout.setSpacing(20)
        main_layout.setContentsMargins(30, 30, 30, 30)

        # 제목
        title_label = QLabel("네이버 블로그 검색 순위")
        title_label.setObjectName("titleLabel")
        title_label.setAlignment(Qt.AlignCenter)
        main_layout.addWidget(title_label)

        # 입력 영역
        input_widget = self.create_input_section()
        main_layout.addWidget(input_widget)

        # 결과 테이블
        self.table = QTableWidget()
        self.table.setObjectName("resultTable")
        self.table.setColumnCount(3)
        self.table.setHorizontalHeaderLabels(["순위", "제목", "링크"])

        # 테이블 헤더 설정
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.Stretch)
        header.setSectionResizeMode(2, QHeaderView.Stretch)

        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.cellDoubleClicked.connect(self.on_cell_double_clicked)

        # 순위 결과 라벨 (테이블 위에 표시)
        self.rank_result_label = QLabel("")
        self.rank_result_label.setObjectName("rankResultLabel")
        self.rank_result_label.setAlignment(Qt.AlignLeft)
        self.rank_result_label.setVisible(False)
        main_layout.addWidget(self.rank_result_label)

        main_layout.addWidget(self.table)

        central_widget.setLayout(main_layout)

        # 스타일 적용
        self.apply_styles()

    def create_input_section(self):
        """입력 섹션 생성"""
        widget = QWidget()
        widget.setObjectName("inputSection")
        layout = QVBoxLayout()
        layout.setSpacing(15)

        # 키워드 입력
        keyword_layout = QHBoxLayout()
        keyword_label = QLabel("검색 키워드")
        keyword_label.setObjectName("inputLabel")
        keyword_label.setMinimumWidth(100)

        self.keyword_input = QLineEdit()
        self.keyword_input.setObjectName("inputField")
        self.keyword_input.setPlaceholderText("검색할 키워드를 입력하세요")

        keyword_layout.addWidget(keyword_label)
        keyword_layout.addWidget(self.keyword_input)

        # 블로그 URL 입력
        url_layout = QHBoxLayout()
        url_label = QLabel("블로그 주소")
        url_label.setObjectName("inputLabel")
        url_label.setMinimumWidth(100)

        self.url_input = QLineEdit()
        self.url_input.setObjectName("inputField")
        self.url_input.setPlaceholderText("확인할 블로그 URL을 입력하세요")

        url_layout.addWidget(url_label)
        url_layout.addWidget(self.url_input)

        # 검색 버튼
        self.search_button = QPushButton("🔍 검색하기")
        self.search_button.setObjectName("searchButton")
        self.search_button.clicked.connect(self.on_search_clicked)

        layout.addLayout(keyword_layout)
        layout.addLayout(url_layout)
        layout.addWidget(self.search_button)

        widget.setLayout(layout)
        return widget

    def apply_styles(self):
        """파스텔톤 브라운 계열 스타일 적용"""

        # Pretendard 폰트 설정 (시스템에 설치되어 있어야 함)
        font = QFont("Pretendard", 10)
        self.setFont(font)

        style = """
            QMainWindow {
                background-color: #FAF8F5;
            }

            #titleLabel {
                font-size: 28px;
                font-weight: bold;
                color: #8B6F47;
                padding: 15px;
                margin-bottom: 10px;
            }

            #inputSection {
                background-color: #F5EFE7;
                border-radius: 12px;
                padding: 20px;
            }

            #rankResultLabel {
                font-size: 16px;
                font-weight: 600;
                color: #6B5744;
                background-color: #FFF8E7;
                border: 2px solid #E8D4A8;
                border-radius: 8px;
                padding: 12px 20px;
                margin-top: 10px;
            }

            #inputLabel {
                font-size: 14px;
                font-weight: 600;
                color: #6B5744;
            }

            #inputField {
                background-color: #FFFFFF;
                border: 2px solid #D4C4B0;
                border-radius: 8px;
                padding: 10px 15px;
                font-size: 13px;
                color: #4A3F35;
            }

            #inputField:focus {
                border: 2px solid #B8996F;
                background-color: #FFFDF9;
            }

            #searchButton {
                background-color: #C9A882;
                color: #FFFFFF;
                border: none;
                border-radius: 8px;
                padding: 12px 30px;
                font-size: 15px;
                font-weight: 600;
                margin-top: 10px;
            }

            #searchButton:hover {
                background-color: #B8996F;
            }

            #searchButton:pressed {
                background-color: #A67C52;
            }

            #searchButton:disabled {
                background-color: #E5DDD3;
                color: #A89B8D;
            }

            #resultTable {
                background-color: #FFFFFF;
                border: 2px solid #E5DDD3;
                border-radius: 8px;
                gridline-color: #F0E8DC;
            }

            #resultTable::item {
                padding: 8px;
                color: #4A3F35;
            }

            #resultTable::item:selected {
                background-color: #E8DCC8;
                color: #3D3228;
            }

            QHeaderView::section {
                background-color: #D4C4B0;
                color: #FFFFFF;
                padding: 10px;
                border: none;
                font-weight: 600;
                font-size: 13px;
            }

            QScrollBar:vertical {
                border: none;
                background-color: #F5EFE7;
                width: 12px;
                margin: 0px;
            }

            QScrollBar::handle:vertical {
                background-color: #D4C4B0;
                border-radius: 6px;
                min-height: 20px;
            }

            QScrollBar::handle:vertical:hover {
                background-color: #C9A882;
            }

            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
                height: 0px;
            }
        """

        self.setStyleSheet(style)

    def on_search_clicked(self):
        """검색 버튼 클릭 이벤트"""
        keyword = self.keyword_input.text().strip()
        target_url = self.url_input.text().strip()

        if not keyword:
            QMessageBox.warning(self, "입력 오류", "검색할 키워드를 입력해주세요.")
            return

        if not target_url:
            QMessageBox.warning(self, "입력 오류", "확인할 블로그 URL을 입력해주세요.")
            return

        # UI 비활성화
        self.search_button.setEnabled(False)
        self.search_button.setText("⏳ 검색 중...")
        self.table.setRowCount(0)

        # 검색 스레드 시작
        self.search_thread = SearchThread(keyword, target_url)
        self.search_thread.finished.connect(self.on_search_finished)
        self.search_thread.error.connect(self.on_search_error)
        self.search_thread.start()

    def on_search_finished(self, results):
        """검색 완료 처리"""
        self.search_button.setEnabled(True)
        self.search_button.setText("🔍 검색하기")

        if not results:
            self.rank_result_label.setVisible(False)
            QMessageBox.information(self, "검색 결과", "상위 100개 결과 내에서 검색 결과를 찾지 못했습니다.")
            return

        # 일치하는 블로그의 순위 정보 표시
        keyword = self.keyword_input.text().strip()
        matched_items = [item for item in results if item['is_match']]

        if matched_items:
            match = matched_items[0]  # 첫 번째 일치 항목
            self.rank_result_label.setText(
                f"검색키워드 : {keyword} , {match['rank']}위"
            )
            self.rank_result_label.setVisible(True)
        else:
            self.rank_result_label.setText(
                f"검색키워드 : {keyword} , 순위 없음 (상위 100위 내에 없음)"
            )
            self.rank_result_label.setVisible(True)

        # 테이블에 결과 추가
        self.table.setRowCount(len(results))

        for row, item in enumerate(results):
            # 순위
            rank_item = QTableWidgetItem(f"{item['rank']}위")
            rank_item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row, 0, rank_item)

            # 제목
            title_item = QTableWidgetItem(item['title'])
            self.table.setItem(row, 1, title_item)

            # 링크
            link_item = QTableWidgetItem(item['link'])
            self.table.setItem(row, 2, link_item)

            # 일치하는 블로그는 파스텔톤 노란색으로 강조
            if item['is_match']:
                pastel_yellow = QColor(255, 253, 208)  # #FFFDD0
                for col in range(3):
                    self.table.item(row, col).setBackground(pastel_yellow)

        # 결과 메시지
        match_count = sum(1 for item in results if item['is_match'])
        if match_count > 0:
            QMessageBox.information(
                self,
                "검색 완료",
                f"총 {len(results)}개의 결과를 찾았습니다.\n일치하는 블로그: {match_count}개 (노란색으로 표시)"
            )
        else:
            QMessageBox.information(
                self,
                "검색 완료",
                f"총 {len(results)}개의 결과를 찾았습니다.\n입력한 블로그 주소와 일치하는 결과가 없습니다."
            )

    def on_search_error(self, error_message):
        """검색 오류 처리"""
        self.search_button.setEnabled(True)
        self.search_button.setText("🔍 검색하기")
        QMessageBox.critical(self, "오류", error_message)
        self.rank_result_label.setVisible(False)

    def on_cell_double_clicked(self, row, column):
        """테이블 셀 더블클릭 시 링크 열기"""
        link_item = self.table.item(row, 2)  # 링크는 3번째 컬럼 (인덱스 2)
        if link_item:
            url = link_item.text()
            if url:
                QDesktopServices.openUrl(QUrl(url))


def main():
    """메인 함수"""
    app = QApplication(sys.argv)

    # Pretendard 폰트 설정
    font = QFont("Pretendard", 10)
    app.setFont(font)

    window = BlogSearchUI()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
