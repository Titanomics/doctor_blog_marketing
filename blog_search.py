# 네이버 블로그 검색 - 키워드 순위 검색기
import urllib.request
import urllib.parse
import json

client_id = "SnGfTbcitrRhEHbWZdWc"
client_secret = "vx1bFHdapy"

def search_blog_rank(keyword, target_url, display=100):
    """
    키워드로 검색하여 특정 블로그 링크의 순위를 찾습니다.

    Args:
        keyword: 검색할 키워드
        target_url: 찾고자 하는 블로그 링크 (일부만 입력해도 됨)
        display: 검색 결과 개수 (최대 100)
    """
    enc_keyword = urllib.parse.quote(keyword)
    url = f"https://openapi.naver.com/v1/search/blog?query={enc_keyword}&display={display}"

    request = urllib.request.Request(url)
    request.add_header("X-Naver-Client-Id", client_id)
    request.add_header("X-Naver-Client-Secret", client_secret)

    response = urllib.request.urlopen(request)

    if response.getcode() == 200:
        result = json.loads(response.read().decode('utf-8'))
        items = result.get('items', [])

        print(f"\n{'='*60}")
        print(f"키워드: {keyword}")
        print(f"검색 대상 URL: {target_url}")
        print(f"전체 검색 결과: {result.get('total', 0)}개")
        print(f"{'='*60}\n")

        found = False
        for idx, item in enumerate(items, 1):
            title = item['title'].replace('<b>', '').replace('</b>', '')
            link = item['link']

            if target_url in link:
                found = True
                print(f"✅ 발견!")
                print(f"   순위: {idx}위")
                print(f"   제목: {title}")
                print(f"   링크: {link}")
                print()

        if not found:
            print(f"❌ 상위 {display}개 결과 내에서 해당 URL을 찾을 수 없습니다.")

    else:
        print(f"Error Code: {response.getcode()}")


if __name__ == "__main__":
    keyword = input("검색할 키워드를 입력하세요: ")
    target_url = input("찾을 블로그 링크를 입력하세요: ")

    search_blog_rank(keyword, target_url)
