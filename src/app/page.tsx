"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  return (
    <main className="home">
      <header className="home-top">
        <span className="logo">
          끄적<em>누구</em>
        </span>
        <span className="hand">낙서로 맞히는 자기소개</span>
      </header>

      <section className="home-hero">
        <h1>
          낙서 한 장,
          <br />
          <mark>TMI 세 줄.</mark>
          <br />
          누군지 맞혀 봐.
        </h1>
        <p className="lead">
          폰으로 내 얼굴을 대충 끄적이고 질문 세 개에 답하면, 큰 화면에 이름 없이 한 명씩 등장해요. 모두가 폰으로 “이 사람 누구게?”를 골라요. 앱 설치·회원가입
          없이 QR 한 번이면 30명이 바로 같이 놀아요.
        </p>
      </section>

      <section className="home-doors">
        <div className="door door-host">
          <span className="door-tag">진행자</span>
          <h2>큰 화면에 방 열기</h2>
          <p>강의실 PC나 빔프로젝터에서 열어 주세요. QR과 방 코드가 바로 떠요.</p>
          <Link className="btn primary big" href="/host">
            방 만들기
          </Link>
        </div>
        <form
          className="door door-player"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean.length === 5) router.push(`/j/${clean}`);
          }}
        >
          <span className="door-tag">참가자</span>
          <h2>방 코드로 들어가기</h2>
          <p>QR을 찍었다면 이미 들어온 거예요. 코드로 들어와도 돼요.</p>
          <div className="code-input">
            <input
              value={clean}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABCDE"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              aria-label="방 코드 5자리"
            />
            <button className="btn dark big" disabled={clean.length !== 5}>
              입장
            </button>
          </div>
        </form>
      </section>

      <ol className="home-steps">
        <li>
          <b>1</b>
          <span>QR 찍고 닉네임만 적기</span>
        </li>
        <li>
          <b>2</b>
          <span>90초 동안 내 얼굴 낙서 + TMI 세 줄</span>
        </li>
        <li>
          <b>3</b>
          <span>큰 화면 속 주인공을 20초 안에 맞히기</span>
        </li>
        <li>
          <b>4</b>
          <span>눈썰미 순위 · 미스터리상 · 낙서 갤러리</span>
        </li>
      </ol>

      <footer className="credit">
        만든 사람 · 양○○ (애즈몽) · 그림과 답은 방이 끝나면 지워지고, 늦어도 2시간 뒤 자동 삭제돼요.
      </footer>
    </main>
  );
}
